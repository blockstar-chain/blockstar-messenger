import { VoiceMessage } from '@/types';

/**
 * Voice Message Service
 * Record, encode, and manage voice messages
 */

// Supported mimeTypes in order of preference
const SUPPORTED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
];

function getSupportedMimeType(): string {
  for (const mimeType of SUPPORTED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      console.log('Using mimeType:', mimeType);
      return mimeType;
    }
  }
  // Fallback - let browser choose
  console.log('No preferred mimeType supported, using browser default');
  return '';
}

export class VoiceMessageService {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private startTime: number = 0;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private waveformData: number[] = [];
  private mimeType: string = '';

  /**
   * Start recording voice message
   */
  async startRecording(): Promise<void> {
    try {
      // Request microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
          channelCount: 1,
        },
      });

      // Verify we have audio tracks
      const audioTracks = this.stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio tracks available');
      }
      console.log('Audio track:', audioTracks[0].label, audioTracks[0].readyState);

      // Setup audio context for waveform visualization
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      source.connect(this.analyser);

      // Get supported mimeType
      this.mimeType = getSupportedMimeType();

      // Create media recorder with options
      const options: MediaRecorderOptions = {};
      if (this.mimeType) {
        options.mimeType = this.mimeType;
      }
      
      this.mediaRecorder = new MediaRecorder(this.stream, options);
      
      // Log the actual mimeType being used
      console.log('MediaRecorder created with mimeType:', this.mediaRecorder.mimeType);

      this.audioChunks = [];
      this.waveformData = [];
      this.startTime = Date.now();

      // Collect audio data
      this.mediaRecorder.ondataavailable = (event) => {
        console.log('Audio data available:', event.data.size, 'bytes');
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onerror = (event: any) => {
        console.error('MediaRecorder error:', event.error);
      };

      // Start recording with timeslice to get data chunks
      this.mediaRecorder.start(250); // Collect data every 250ms

      // Start waveform capture
      this.captureWaveform();

      console.log('Voice recording started');
    } catch (error) {
      console.error('Failed to start recording:', error);
      this.cleanup();
      throw new Error('Failed to access microphone');
    }
  }

  /**
   * Stop recording and get voice message
   */
  async stopRecording(): Promise<VoiceMessage> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('No recording in progress'));
        return;
      }

      if (this.mediaRecorder.state === 'inactive') {
        reject(new Error('Recording already stopped'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const duration = (Date.now() - this.startTime) / 1000;
        
        console.log('Recording stopped. Chunks:', this.audioChunks.length);
        console.log('Total size:', this.audioChunks.reduce((acc, chunk) => acc + chunk.size, 0), 'bytes');
        
        if (this.audioChunks.length === 0) {
          this.cleanup();
          reject(new Error('No audio data recorded'));
          return;
        }

        // Use the actual mimeType from the recorder
        const actualMimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        const blob = new Blob(this.audioChunks, { type: actualMimeType });
        
        console.log('Created blob:', blob.size, 'bytes, type:', blob.type);

        if (blob.size === 0) {
          this.cleanup();
          reject(new Error('Empty audio recording'));
          return;
        }

        const voiceMessage: VoiceMessage = {
          id: `voice_${Date.now()}`,
          blob,
          duration,
          waveform: this.normalizeWaveform(this.waveformData),
          url: URL.createObjectURL(blob),
        };

        this.cleanup();
        resolve(voiceMessage);
      };

      // Request final data before stopping
      if (this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.requestData();
      }
      
      this.mediaRecorder.stop();
    });
  }

  /**
   * Cancel recording
   */
  cancelRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.cleanup();
  }

  /**
   * Get current recording duration
   */
  getDuration(): number {
    if (this.startTime === 0) return 0;
    return (Date.now() - this.startTime) / 1000;
  }

  /**
   * Get current waveform data
   */
  getCurrentWaveform(): number[] {
    return this.normalizeWaveform(this.waveformData);
  }

  /**
   * Capture waveform data for visualization
   */
  private captureWaveform(): void {
    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const capture = () => {
      if (!this.analyser || this.mediaRecorder?.state !== 'recording') {
        return;
      }

      this.analyser.getByteTimeDomainData(dataArray);

      // Calculate RMS (Root Mean Square) for amplitude
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const value = (dataArray[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / bufferLength);

      this.waveformData.push(rms);

      requestAnimationFrame(capture);
    };

    capture();
  }

  /**
   * Normalize waveform data for display
   */
  private normalizeWaveform(data: number[]): number[] {
    if (data.length === 0) return [];

    const maxValue = Math.max(...data);
    if (maxValue === 0) return data.map(() => 50); // Return flat line if no audio
    
    const targetLength = 50; // Fixed number of bars
    const chunkSize = Math.ceil(data.length / targetLength);

    const normalized: number[] = [];
    for (let i = 0; i < targetLength; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, data.length);
      const chunk = data.slice(start, end);
      const avg = chunk.reduce((a, b) => a + b, 0) / chunk.length;
      normalized.push((avg / maxValue) * 100);
    }

    return normalized;
  }

  /**
   * Convert voice message to File for upload
   */
  async voiceMessageToFile(voiceMessage: VoiceMessage): Promise<File> {
    // Determine file extension based on blob type
    let extension = 'webm';
    if (voiceMessage.blob.type.includes('ogg')) {
      extension = 'ogg';
    } else if (voiceMessage.blob.type.includes('mp4')) {
      extension = 'mp4';
    } else if (voiceMessage.blob.type.includes('mpeg') || voiceMessage.blob.type.includes('mp3')) {
      extension = 'mp3';
    } else if (voiceMessage.blob.type.includes('wav')) {
      extension = 'wav';
    }
    
    const filename = `voice_${voiceMessage.id}.${extension}`;
    console.log('Creating file:', filename, 'type:', voiceMessage.blob.type, 'size:', voiceMessage.blob.size);
    
    return new File(
      [voiceMessage.blob],
      filename,
      { type: voiceMessage.blob.type || 'audio/webm' }
    );
  }

  /**
   * Play voice message
   */
  playVoiceMessage(voiceMessage: VoiceMessage): HTMLAudioElement {
    const audio = new Audio(voiceMessage.url);
    audio.play();
    return audio;
  }

  /**
   * Get audio duration from blob
   */
  async getAudioDuration(blob: Blob): Promise<number> {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.src = URL.createObjectURL(blob);
      
      audio.addEventListener('loadedmetadata', () => {
        resolve(audio.duration);
        URL.revokeObjectURL(audio.src);
      });
    });
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.analyser = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.waveformData = [];
    this.startTime = 0;
    this.mimeType = '';
  }

  /**
   * Check if recording is in progress
   */
  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  /**
   * Check if microphone is available
   */
  async checkMicrophoneAvailable(): Promise<boolean> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some((device) => device.kind === 'audioinput');
    } catch {
      return false;
    }
  }
}

export const voiceMessageService = new VoiceMessageService();
