// frontend/src/lib/native/AudioRoutingService.ts
// TypeScript wrapper for AudioRouting Capacitor plugin

import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

// ============================================
// TYPES
// ============================================

interface AudioRouteResult {
  success: boolean;
  speaker: boolean;
  mode?: string;
}

interface AudioRouteInfo {
  route: 'speaker' | 'earpiece' | 'bluetooth' | 'default' | 'unknown';
  speaker: boolean;
  mode: string;
  bluetoothSco: boolean;
}

interface AvailableDevices {
  earpiece: boolean;
  speaker: boolean;
  bluetooth: boolean;
  wiredHeadset: boolean;
}

interface AudioRoutingPluginInterface {
  setAudioRoute(options: { speaker: boolean }): Promise<AudioRouteResult>;
  getAudioRoute(): Promise<AudioRouteInfo>;
  initializeCallAudio(): Promise<AudioRouteResult>;
  resetAudio(): Promise<{ success: boolean }>;
  toggleSpeaker(): Promise<AudioRouteResult>;
  isSpeakerOn(): Promise<{ speaker: boolean }>;
  getAvailableDevices(): Promise<AvailableDevices>;
}

// Register the plugin
const AudioRoutingPlugin = registerPlugin<AudioRoutingPluginInterface>('AudioRouting');

// ============================================
// SERVICE CLASS
// ============================================

class AudioRoutingService {
  private static instance: AudioRoutingService;
  private initialized = false;
  private _isSpeakerOn = false;

  private constructor() {}

  static getInstance(): AudioRoutingService {
    if (!AudioRoutingService.instance) {
      AudioRoutingService.instance = new AudioRoutingService();
    }
    return AudioRoutingService.instance;
  }

  /**
   * Check if running on native platform
   */
  isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Initialize audio for a call
   * IMPORTANT: Call this when starting a voice/video call
   */
  async initializeForCall(): Promise<boolean> {
    if (!this.isNative()) {
      console.log('AudioRouting: Not on native platform, skipping init');
      return true;
    }

    try {
      console.log('🔊 Initializing call audio...');
      const result = await AudioRoutingPlugin.initializeCallAudio();
      this.initialized = true;
      this._isSpeakerOn = false;
      console.log('🔊 Call audio initialized:', result);
      return result.success;
    } catch (error) {
      console.error('🔊 Failed to initialize call audio:', error);
      return false;
    }
  }

  /**
   * Set audio to speaker
   */
  async setSpeaker(): Promise<boolean> {
    if (!this.isNative()) {
      this._isSpeakerOn = true;
      return true;
    }

    try {
      console.log('🔊 Switching to SPEAKER...');
      const result = await AudioRoutingPlugin.setAudioRoute({ speaker: true });
      this._isSpeakerOn = result.speaker;
      console.log('🔊 Speaker result:', result);
      return result.speaker;
    } catch (error) {
      console.error('🔊 Failed to set speaker:', error);
      return false;
    }
  }

  /**
   * Set audio to earpiece
   */
  async setEarpiece(): Promise<boolean> {
    if (!this.isNative()) {
      this._isSpeakerOn = false;
      return true;
    }

    try {
      console.log('🔊 Switching to EARPIECE...');
      const result = await AudioRoutingPlugin.setAudioRoute({ speaker: false });
      this._isSpeakerOn = result.speaker;
      console.log('🔊 Earpiece result:', result);
      return !result.speaker;
    } catch (error) {
      console.error('🔊 Failed to set earpiece:', error);
      return false;
    }
  }

  /**
   * Toggle between speaker and earpiece
   */
  async toggle(): Promise<boolean> {
    if (!this.isNative()) {
      this._isSpeakerOn = !this._isSpeakerOn;
      return this._isSpeakerOn;
    }

    try {
      console.log('🔊 Toggling speaker...');
      const result = await AudioRoutingPlugin.toggleSpeaker();
      this._isSpeakerOn = result.speaker;
      console.log('🔊 Toggle result - speaker:', result.speaker);
      return result.speaker;
    } catch (error) {
      console.error('🔊 Failed to toggle speaker:', error);
      // Try manual toggle
      return this._isSpeakerOn ? await this.setEarpiece().then(() => false) : await this.setSpeaker().then(() => true);
    }
  }

  /**
   * Check if speaker is currently on
   */
  async isSpeakerOn(): Promise<boolean> {
    if (!this.isNative()) {
      return this._isSpeakerOn;
    }

    try {
      const result = await AudioRoutingPlugin.isSpeakerOn();
      this._isSpeakerOn = result.speaker;
      return result.speaker;
    } catch (error) {
      console.error('🔊 Failed to check speaker state:', error);
      return this._isSpeakerOn;
    }
  }

  /**
   * Get current audio route information
   */
  async getCurrentRoute(): Promise<AudioRouteInfo | null> {
    if (!this.isNative()) {
      return {
        route: this._isSpeakerOn ? 'speaker' : 'earpiece',
        speaker: this._isSpeakerOn,
        mode: 'web',
        bluetoothSco: false
      };
    }

    try {
      return await AudioRoutingPlugin.getAudioRoute();
    } catch (error) {
      console.error('🔊 Failed to get audio route:', error);
      return null;
    }
  }

  /**
   * Get available audio devices
   */
  async getAvailableDevices(): Promise<AvailableDevices | null> {
    if (!this.isNative()) {
      return {
        earpiece: true,
        speaker: true,
        bluetooth: false,
        wiredHeadset: false
      };
    }

    try {
      return await AudioRoutingPlugin.getAvailableDevices();
    } catch (error) {
      console.error('🔊 Failed to get available devices:', error);
      return null;
    }
  }

  /**
   * Reset audio after call ends
   * IMPORTANT: Call this when ending a voice/video call
   */
  async resetAfterCall(): Promise<void> {
    if (!this.isNative()) {
      this._isSpeakerOn = false;
      this.initialized = false;
      return;
    }

    try {
      console.log('🔊 Resetting audio after call...');
      await AudioRoutingPlugin.resetAudio();
      this.initialized = false;
      this._isSpeakerOn = false;
      console.log('🔊 Audio reset complete');
    } catch (error) {
      console.error('🔊 Failed to reset audio:', error);
    }
  }

  /**
   * Get cached speaker state (synchronous)
   */
  get speakerOn(): boolean {
    return this._isSpeakerOn;
  }
}

// Export singleton instance
export const audioRoutingService = AudioRoutingService.getInstance();

// ============================================
// USAGE IN CALL COMPONENT
// ============================================
/*

import { audioRoutingService } from '@/lib/native/AudioRoutingService';

// When call starts:
useEffect(() => {
  if (isInCall) {
    audioRoutingService.initializeForCall();
  }
  
  return () => {
    if (isInCall) {
      audioRoutingService.resetAfterCall();
    }
  };
}, [isInCall]);

// Speaker toggle button:
const [isSpeaker, setIsSpeaker] = useState(false);

const handleToggleSpeaker = async () => {
  const newState = await audioRoutingService.toggle();
  setIsSpeaker(newState);
};

// In your JSX:
<button onClick={handleToggleSpeaker}>
  {isSpeaker ? <SpeakerIcon /> : <EarpieceIcon />}
</button>

*/
