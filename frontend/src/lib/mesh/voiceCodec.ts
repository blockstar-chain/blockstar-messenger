// frontend/src/lib/mesh/voiceCodec.ts
// Cross-platform voice codec for the walkie-talkie.
//
// THE PROBLEM THIS SOLVES: MediaRecorder produces webm/opus on Android and
// mp4/aac on iOS WKWebView, so a segment recorded on Android can't be decoded on
// iOS and vice-versa. Here we bypass native containers entirely: capture PCM via
// Web Audio, encode with a wasm libopus (opus-recorder) into a self-contained
// Ogg/Opus blob, and decode with a wasm decoder (ogg-opus-decoder). Because BOTH
// platforms run the SAME wasm codec, every segment is decodable everywhere.
//
// DEPENDENCIES (add to frontend/package.json):
//   npm i opus-recorder ogg-opus-decoder
//
// SERVED ASSETS (opus-recorder loads its encoder worker + wasm at runtime):
//   Copy from node_modules/opus-recorder/dist/ into frontend/public/opus/:
//     encoderWorker.min.js
//     encoderWorker.min.wasm
//   (ogg-opus-decoder inlines its own wasm — nothing to copy for decode.)
//
// If the Opus libs aren't present/loadable, this module reports unavailable and
// WalkieTalkieService falls back to the MediaRecorder path automatically.

export interface EncodedSegment {
  bytes: Uint8Array;
  mime: string; // 'audio/ogg;codecs=opus' for Opus, else the recorder's mime
}

export interface VoiceEncoder {
  readonly mime: string;
  /** Acquire mic + begin capturing a segment. */
  start(): Promise<void>;
  /** Stop capturing; resolve with the encoded bytes for this segment. */
  stop(): Promise<Uint8Array>;
  /** Release the mic. */
  release(): void;
}

export interface DecodedAudio {
  channelData: Float32Array[];
  sampleRate: number;
}

// Path where opus-recorder's worker/wasm are served (see notes above).
const OPUS_ENCODER_PATH = '/opus/encoderWorker.min.js';
const OPUS_MIME = 'audio/ogg;codecs=opus';

let opusChecked = false;
let opusAvailable = false;
let RecorderCtor: any = null;
let OggOpusDecoderCtor: any = null;

/** True if the wasm Opus pipeline can be used (checked once, lazily). */
export async function opusSupported(): Promise<boolean> {
  if (opusChecked) return opusAvailable;
  opusChecked = true;
  try {
    const recMod: any = await import('opus-recorder');
    RecorderCtor = recMod.default || recMod;
    const decMod: any = await import('ogg-opus-decoder');
    OggOpusDecoderCtor = decMod.OggOpusDecoder || decMod.default;
    opusAvailable = !!RecorderCtor && !!OggOpusDecoderCtor && typeof WebAssembly !== 'undefined';
  } catch (e) {
    console.warn('[voiceCodec] Opus wasm not available, will fall back:', e);
    opusAvailable = false;
  }
  return opusAvailable;
}

// ============================================
// OPUS (cross-platform)
// ============================================

class OpusEncoder implements VoiceEncoder {
  readonly mime = OPUS_MIME;
  private recorder: any = null;
  private pages: Uint8Array[] = [];

  async start(): Promise<void> {
    this.pages = [];
    this.recorder = new RecorderCtor({
      encoderPath: OPUS_ENCODER_PATH,
      numberOfChannels: 1,
      encoderSampleRate: 48000,
      encoderApplication: 2048, // OPUS_APPLICATION_VOIP
      encoderFrameSize: 20, // ms
      streamPages: false, // one complete Ogg (with headers) on stop
      // opus-recorder acquires the mic itself with these constraints:
      mediaTrackConstraints: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.recorder.ondataavailable = (typedArray: Uint8Array) => {
      // With streamPages:false this fires once on stop with the full file.
      this.pages.push(typedArray);
    };
    await this.recorder.start();
  }

  stop(): Promise<Uint8Array> {
    return new Promise((resolve) => {
      if (!this.recorder) return resolve(new Uint8Array(0));
      const rec = this.recorder;
      const prev = rec.onstop;
      rec.onstop = () => {
        if (prev) try { prev(); } catch {/* noop */}
        resolve(concat(this.pages));
      };
      try {
        rec.stop();
      } catch {
        resolve(concat(this.pages));
      }
    });
  }

  release(): void {
    try {
      this.recorder?.close?.();
    } catch {/* noop */}
    this.recorder = null;
    this.pages = [];
  }
}

let sharedDecoder: any = null;
async function getOpusDecoder(): Promise<any> {
  if (!sharedDecoder) {
    sharedDecoder = new OggOpusDecoderCtor();
    await sharedDecoder.ready;
  }
  return sharedDecoder;
}

async function decodeOpus(bytes: Uint8Array): Promise<DecodedAudio> {
  const decoder = await getOpusDecoder();
  // ogg-opus-decoder keeps state across calls for a stream; for independent
  // segments we reset so each self-contained Ogg decodes cleanly.
  try { decoder.reset?.(); } catch {/* noop */}
  const { channelData, sampleRate } = await decoder.decode(bytes);
  return { channelData, sampleRate: sampleRate || 48000 };
}

// ============================================
// MEDIARECORDER FALLBACK (same-platform only)
// ============================================

const MR_PREFERRED = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/aac',
];

class MediaRecorderEncoder implements VoiceEncoder {
  readonly mime: string;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(mime: string) {
    this.mime = mime;
  }

  static pickMime(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    for (const m of MR_PREFERRED) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {/* noop */}
    }
    return '';
  }

  async start(): Promise<void> {
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    }
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType: this.mime });
    this.recorder.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    this.recorder.start();
  }

  stop(): Promise<Uint8Array> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec) return resolve(new Uint8Array(0));
      rec.onstop = async () => {
        const blob = new Blob(this.chunks, { type: this.mime });
        resolve(new Uint8Array(await blob.arrayBuffer()));
      };
      try { rec.stop(); } catch { resolve(new Uint8Array(0)); }
    });
  }

  release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}

// ============================================
// PUBLIC FACTORY + PLAYBACK
// ============================================

/** Create the best available encoder. Prefers cross-platform Opus. */
export async function createEncoder(): Promise<VoiceEncoder> {
  if (await opusSupported()) return new OpusEncoder();
  const mime = MediaRecorderEncoder.pickMime();
  if (!mime) throw new Error('No audio encoder available on this device');
  return new MediaRecorderEncoder(mime);
}

// Shared playback context + per-sender gapless scheduler.
let audioCtx: AudioContext | null = null;
const nextStartBySender = new Map<string, number>();

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}

/** Unlock audio on a user gesture (needed on iOS). Call from a click/touch. */
export async function unlockAudio(): Promise<void> {
  const ctx = getCtx();
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch {/* noop */}
  }
}

/**
 * Play one received segment. Opus (Ogg) is decoded via wasm and scheduled
 * gaplessly per sender; MediaRecorder blobs fall back to an <audio> element.
 */
export async function playSegment(senderId: string, bytes: Uint8Array, mime: string): Promise<void> {
  const isOpus = mime.includes('ogg') || mime.includes('opus');
  if (isOpus && (await opusSupported())) {
    try {
      const { channelData, sampleRate } = await decodeOpus(bytes);
      schedulePcm(senderId, channelData, sampleRate);
      return;
    } catch (e) {
      console.warn('[voiceCodec] opus decode failed, trying element playback', e);
    }
  }
  await playViaElement(bytes, mime);
}

function schedulePcm(senderId: string, channelData: Float32Array[], sampleRate: number): void {
  const ctx = getCtx();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const channels = channelData.length || 1;
  const frames = channelData[0]?.length || 0;
  if (frames === 0) return;

  const buffer = ctx.createBuffer(channels, frames, sampleRate);
  for (let c = 0; c < channels; c++) buffer.copyToChannel(channelData[c], c);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);

  const now = ctx.currentTime;
  const prev = nextStartBySender.get(senderId) || 0;
  const startAt = Math.max(now + 0.02, prev);
  src.start(startAt);
  nextStartBySender.set(senderId, startAt + buffer.duration);

  src.onended = () => {
    // reset if we've caught up, so latency doesn't accumulate after a pause
    if ((nextStartBySender.get(senderId) || 0) <= ctx.currentTime + 0.05) {
      nextStartBySender.delete(senderId);
    }
  };
}

function playViaElement(bytes: Uint8Array, mime: string): Promise<void> {
  return new Promise((resolve) => {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const done = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  });
}

// ============================================
// helpers
// ============================================

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
