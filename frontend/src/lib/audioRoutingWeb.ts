// frontend/src/lib/audioRoutingWeb.ts
// Web fallback implementation for audio routing
// On web, we can't control audio routing, so this is mostly a no-op

import type { AudioRoutingPlugin } from './audioRouting';

export class AudioRoutingWeb implements AudioRoutingPlugin {
  private speakerOn = true; // Web defaults to speaker

  async setVoiceCallMode(): Promise<void> {
    console.log('📞 [Web] setVoiceCallMode - not supported on web');
  }

  async setDefaultMode(): Promise<void> {
    console.log('📞 [Web] setDefaultMode - not supported on web');
  }

  async setSpeakerOn(): Promise<void> {
    console.log('📞 [Web] setSpeakerOn');
    this.speakerOn = true;
  }

  async setSpeakerOff(): Promise<void> {
    console.log('📞 [Web] setSpeakerOff - not supported on web (always uses speaker)');
    this.speakerOn = false;
  }

  async isSpeakerOn(): Promise<{ enabled: boolean }> {
    return { enabled: this.speakerOn };
  }

  async getCurrentRoute(): Promise<{ route: 'earpiece' | 'speaker' | 'bluetooth' | 'headset' }> {
    return { route: 'speaker' };
  }
}
