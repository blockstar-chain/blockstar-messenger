import { VoiceMessage } from '@/types';

/**
 * Voice Message Service
 * Record, encode, and manage voice messages
 */

export class VoiceMessageService {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private startTime: number = 0;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private waveformData: number[] = [];

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
        },
      });

      // Setup audio context for waveform visualization
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      source.connect(this.analyser);

      // Create media recorder
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      this.audioChunks = [];
      this.waveformData = [];
      this.startTime = Date.now();

      // Collect audio data
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      // Start recording
      this.mediaRecorder.start(100); // Collect data every 100ms

      // Start waveform capture
      this.captureWaveform();

      console.log('Voice recording started');
    } catch (error) {
      console.error('Failed to start recording:', error);
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

      this.mediaRecorder.onstop = () => {
        const duration = (Date.now() - this.startTime) / 1000;
        const blob = new Blob(this.audioChunks, { type: 'audio/webm' });

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
    return new File(
      [voiceMessage.blob],
      `voice_${voiceMessage.id}.webm`,
      { type: 'audio/webm' }
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
