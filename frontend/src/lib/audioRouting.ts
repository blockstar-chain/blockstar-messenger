// frontend/src/lib/audioRouting.ts
// Audio routing service for phone-like call experience on mobile
// Routes audio to earpiece by default, with option to switch to speaker

import { Capacitor, registerPlugin } from '@capacitor/core';

// Define the plugin interface
export interface AudioRoutingPlugin {
  // Set audio mode for voice call (enables earpiece)
  setVoiceCallMode(): Promise<void>;
  
  // Set audio mode for media/default (speaker)
  setDefaultMode(): Promise<void>;
  
  // Enable speakerphone
  setSpeakerOn(): Promise<void>;
  
  // Disable speakerphone (use earpiece)
  setSpeakerOff(): Promise<void>;
  
  // Check if speaker is currently on
  isSpeakerOn(): Promise<{ enabled: boolean }>;
  
  // Get current audio route
  getCurrentRoute(): Promise<{ route: 'earpiece' | 'speaker' | 'bluetooth' | 'headset' }>;
}

// Register the native plugin
const AudioRouting = registerPlugin<AudioRoutingPlugin>('AudioRouting', {
  web: () => import('./audioRoutingWeb').then(m => new m.AudioRoutingWeb()),
});

// Check if we're on a native platform
const isNative = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform();

// Track current speaker state
let speakerEnabled = false;

/**
 * Initialize audio routing for a voice call
 * This sets up the audio session for voice communication (earpiece by default)
 */
export async function initCallAudio(): Promise<void> {
  if (!isNative) {
    console.log('📞 Audio routing: Web platform, using default audio');
    return;
  }

  try {
    console.log('📞 Initializing call audio mode...');
    await AudioRouting.setVoiceCallMode();
    await AudioRouting.setSpeakerOff();
    speakerEnabled = false;
    console.log('✅ Call audio initialized - using earpiece');
  } catch (error) {
    console.error('❌ Failed to initialize call audio:', error);
  }
}

/**
 * Reset audio routing when call ends
 */
export async function resetCallAudio(): Promise<void> {
  if (!isNative) return;

  try {
    console.log('📞 Resetting audio to default mode...');
    await AudioRouting.setDefaultMode();
    speakerEnabled = false;
    console.log('✅ Audio reset to default');
  } catch (error) {
    console.error('❌ Failed to reset audio:', error);
  }
}

/**
 * Toggle speakerphone on/off
 * @returns Whether speaker is now enabled
 */
export async function toggleSpeaker(): Promise<boolean> {
  if (!isNative) {
    // On web, we can't control this, but track state anyway
    speakerEnabled = !speakerEnabled;
    console.log('📞 Speaker toggle (web):', speakerEnabled);
    return speakerEnabled;
  }

  try {
    if (speakerEnabled) {
      await AudioRouting.setSpeakerOff();
      speakerEnabled = false;
      console.log('📞 Speaker OFF - using earpiece');
    } else {
      await AudioRouting.setSpeakerOn();
      speakerEnabled = true;
      console.log('📞 Speaker ON');
    }
    return speakerEnabled;
  } catch (error) {
    console.error('❌ Failed to toggle speaker:', error);
    return speakerEnabled;
  }
}

/**
 * Set speaker state explicitly
 */
export async function setSpeaker(enabled: boolean): Promise<void> {
  if (!isNative) {
    speakerEnabled = enabled;
    return;
  }

  try {
    if (enabled) {
      await AudioRouting.setSpeakerOn();
    } else {
      await AudioRouting.setSpeakerOff();
    }
    speakerEnabled = enabled;
    console.log('📞 Speaker set to:', enabled ? 'ON' : 'OFF');
  } catch (error) {
    console.error('❌ Failed to set speaker:', error);
  }
}

/**
 * Check if speaker is currently enabled
 */
export async function isSpeakerEnabled(): Promise<boolean> {
  if (!isNative) {
    return speakerEnabled;
  }

  try {
    const result = await AudioRouting.isSpeakerOn();
    speakerEnabled = result.enabled;
    return result.enabled;
  } catch (error) {
    console.error('❌ Failed to check speaker state:', error);
    return speakerEnabled;
  }
}

/**
 * Get current audio route
 */
export async function getCurrentAudioRoute(): Promise<'earpiece' | 'speaker' | 'bluetooth' | 'headset'> {
  if (!isNative) {
    return 'speaker'; // Web always uses speaker
  }

  try {
    const result = await AudioRouting.getCurrentRoute();
    return result.route;
  } catch (error) {
    console.error('❌ Failed to get audio route:', error);
    return speakerEnabled ? 'speaker' : 'earpiece';
  }
}

export default {
  initCallAudio,
  resetCallAudio,
  toggleSpeaker,
  setSpeaker,
  isSpeakerEnabled,
  getCurrentAudioRoute,
  isNative,
  platform,
};
