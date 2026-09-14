// frontend/src/lib/mesh/WalkieTalkieService.ts
// BlockStar Cypher - Walkie-Talkie / Push-To-Talk over the mesh (v2)
//
// v2 change: audio now goes through voiceCodec (wasm Opus, cross-platform), so
// iOS<->Android push-to-talk works. Falls back to MediaRecorder automatically if
// the Opus libs/assets aren't present. The mesh transport is unchanged: each
// segment is a 'voice' MeshMessage sent to every connected peer, so it rides
// whatever transport is live (WebRTC / WiFi Direct / Local WiFi).
//
// Half-duplex push-to-talk: hold to talk, release to stop.
//  - segmentMs = 0 (default): one self-contained clip sent on release (rock solid).
//  - segmentMs > 0: near-live streaming in chunks (small gap per chunk on Opus
//    because the mic is re-armed each segment).

import { meshNetworkService } from './MeshNetworkService';
import { createEncoder, playSegment, unlockAudio, VoiceEncoder } from './voiceCodec';

export type WalkieState = 'idle' | 'transmitting' | 'receiving';

export interface WalkieTalker {
  address: string;
  name?: string;
  since: number;
}

export interface WalkieStatus {
  state: WalkieState;
  channel: string;
  isTransmitting: boolean;
  remoteTalkers: WalkieTalker[];
  connectedPeers: number;
  micReady: boolean;
  error?: string;
}

type StatusHandler = (status: WalkieStatus) => void;

interface VoiceEnvelope {
  wt: 1;
  channel: string;
  kind: 'segment' | 'talk-start' | 'talk-end';
  from: string;
  fromName?: string;
  seq?: number;
  mime?: string;
  data?: string; // base64 encoded bytes for 'segment'
}

const TALKER_TIMEOUT = 4000;

class WalkieTalkieService {
  private initialized = false;
  private channel = 'main';
  private myAddress = '';
  private myName = '';

  private state: WalkieState = 'idle';
  private micReady = false;
  private lastError: string | undefined;

  private encoder: VoiceEncoder | null = null;
  private segmentMs = 0; // 0 = whole-utterance; >0 = near-live segments
  private segTimer: ReturnType<typeof setInterval> | null = null;
  private cutting = false;
  private seq = 0;

  private talkers = new Map<string, WalkieTalker>();
  private talkerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private playChains = new Map<string, Promise<void>>();

  private statusHandlers = new Set<StatusHandler>();
  private unsubscribeMesh: (() => void) | null = null;

  // ============================================
  // LIFECYCLE
  // ============================================

  initialize(opts: { myAddress: string; myName?: string; channel?: string; segmentMs?: number }): void {
    this.myAddress = opts.myAddress.toLowerCase();
    this.myName = opts.myName || '';
    if (opts.channel) this.channel = opts.channel;
    if (typeof opts.segmentMs === 'number') this.segmentMs = Math.max(0, opts.segmentMs);

    if (this.initialized) return;

    this.unsubscribeMesh = meshNetworkService.onMessage((message) => {
      if (message.type !== 'voice') return;
      this.handleIncoming(message.content, message.from);
    });

    this.initialized = true;
    console.log('🎙️ [WalkieTalkie] Initialized on channel:', this.channel);
    this.emit();
  }

  shutdown(): void {
    void this.stopTalking();
    this.unsubscribeMesh?.();
    this.unsubscribeMesh = null;
    this.talkerTimers.forEach((t) => clearTimeout(t));
    this.talkerTimers.clear();
    this.talkers.clear();
    this.playChains.clear();
    this.encoder?.release();
    this.encoder = null;
    this.initialized = false;
  }

  setChannel(channel: string): void {
    this.channel = channel || 'main';
    this.emit();
  }

  setSegmentMs(ms: number): void {
    this.segmentMs = Math.max(0, ms);
  }

  // ============================================
  // TRANSMIT (PUSH TO TALK)
  // ============================================

  async startTalking(): Promise<boolean> {
    if (this.state === 'transmitting') return true;

    if (meshNetworkService.getConnectedPeers().length === 0) {
      this.lastError = 'No one connected to talk to';
      this.emit();
      return false;
    }

    try {
      await unlockAudio(); // this call is inside a user gesture
      this.encoder = await createEncoder();
      await this.encoder.start();
      this.micReady = true;
      this.lastError = undefined;
      this.state = 'transmitting';
      this.seq = 0;
      this.broadcast({ kind: 'talk-start' });

      if (this.segmentMs > 0) {
        this.segTimer = setInterval(() => void this.cutSegment(), this.segmentMs);
      }
      this.emit();
      return true;
    } catch (e: any) {
      this.lastError = e?.message || 'Microphone unavailable';
      this.micReady = false;
      this.state = 'idle';
      this.encoder?.release();
      this.encoder = null;
      this.emit();
      return false;
    }
  }

  async stopTalking(): Promise<void> {
    if (this.state !== 'transmitting') return;
    this.state = 'idle';

    if (this.segTimer) {
      clearInterval(this.segTimer);
      this.segTimer = null;
    }

    // Flush the final (or only) segment
    if (this.encoder && !this.cutting) {
      try {
        const bytes = await this.encoder.stop();
        if (bytes.length) this.broadcastSegment(bytes, this.encoder.mime);
      } catch (e) {
        console.error('[WalkieTalkie] final stop error', e);
      }
    }
    this.broadcast({ kind: 'talk-end' });
    this.encoder?.release();
    this.encoder = null;
    this.emit();
  }

  /** Mid-hold segment boundary (only when segmentMs > 0). */
  private async cutSegment(): Promise<void> {
    if (this.state !== 'transmitting' || !this.encoder || this.cutting) return;
    this.cutting = true;
    try {
      const bytes = await this.encoder.stop();
      if (bytes.length) this.broadcastSegment(bytes, this.encoder.mime);
      if (this.state === 'transmitting') {
        await this.encoder.start(); // arm the next segment
      }
    } catch (e) {
      console.error('[WalkieTalkie] cutSegment error', e);
    } finally {
      this.cutting = false;
    }
  }

  private broadcastSegment(bytes: Uint8Array, mime: string): void {
    this.broadcast({ kind: 'segment', seq: this.seq++, mime, data: bytesToBase64(bytes) });
  }

  private broadcast(partial: Omit<VoiceEnvelope, 'wt' | 'channel' | 'from' | 'fromName'>): void {
    const envelope: VoiceEnvelope = {
      wt: 1,
      channel: this.channel,
      from: this.myAddress,
      fromName: this.myName,
      ...partial,
    };
    const payload = JSON.stringify(envelope);
    for (const peer of meshNetworkService.getConnectedPeers()) {
      void meshNetworkService.sendMessage(peer.walletAddress, payload, 'voice');
    }
  }

  // ============================================
  // RECEIVE + PLAYBACK
  // ============================================

  private handleIncoming(content: string, from: string): void {
    let env: VoiceEnvelope;
    try {
      env = JSON.parse(content);
    } catch {
      return;
    }
    if (!env || env.wt !== 1) return;
    if (env.channel !== this.channel) return;
    if (env.from?.toLowerCase() === this.myAddress) return;

    const addr = (env.from || from).toLowerCase();

    switch (env.kind) {
      case 'talk-start':
        this.markTalker(addr, env.fromName);
        break;
      case 'talk-end':
        this.clearTalker(addr);
        break;
      case 'segment':
        if (env.data) {
          this.markTalker(addr, env.fromName);
          this.enqueuePlay(addr, base64ToBytes(env.data), env.mime || 'audio/ogg;codecs=opus');
        }
        break;
    }
  }

  /** Serialize playback per sender so segments play in order. */
  private enqueuePlay(sender: string, bytes: Uint8Array, mime: string): void {
    const prev = this.playChains.get(sender) || Promise.resolve();
    const next = prev.then(() => playSegment(sender, bytes, mime)).catch((e) =>
      console.warn('[WalkieTalkie] playback error', e)
    );
    this.playChains.set(sender, next);
  }

  // ============================================
  // TALKER TRACKING
  // ============================================

  private markTalker(addr: string, name?: string): void {
    const existing = this.talkers.get(addr);
    this.talkers.set(addr, {
      address: addr,
      name: name || existing?.name,
      since: existing?.since || Date.now(),
    });
    if (this.state !== 'transmitting') this.state = 'receiving';

    const prev = this.talkerTimers.get(addr);
    if (prev) clearTimeout(prev);
    this.talkerTimers.set(addr, setTimeout(() => this.clearTalker(addr), TALKER_TIMEOUT));
    this.emit();
  }

  private clearTalker(addr: string): void {
    this.talkers.delete(addr);
    const t = this.talkerTimers.get(addr);
    if (t) clearTimeout(t);
    this.talkerTimers.delete(addr);
    if (this.talkers.size === 0 && this.state === 'receiving') this.state = 'idle';
    this.emit();
  }

  // ============================================
  // STATUS
  // ============================================

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    handler(this.getStatus());
    return () => this.statusHandlers.delete(handler);
  }

  getStatus(): WalkieStatus {
    return {
      state: this.state,
      channel: this.channel,
      isTransmitting: this.state === 'transmitting',
      remoteTalkers: Array.from(this.talkers.values()),
      connectedPeers: meshNetworkService.getConnectedPeers().length,
      micReady: this.micReady,
      error: this.lastError,
    };
  }

  private emit(): void {
    const s = this.getStatus();
    this.statusHandlers.forEach((h) => {
      try {
        h(s);
      } catch (e) {
        console.error('[WalkieTalkie] status handler error', e);
      }
    });
  }
}

// ============================================
// base64 helpers (chunked, safe for large buffers)
// ============================================

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const walkieTalkieService = new WalkieTalkieService();
