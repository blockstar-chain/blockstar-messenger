// frontend/src/lib/audioRouting.ts
// Audio routing service for phone-like call experience on mobile
// Routes audio to earpiece by default, with option to switch to speaker

import { Capacitor } from '@capacitor/core';

// Check platform
const isNativePlatform = Capacitor.isNativePlatform();
const currentPlatform = Capacitor.getPlatform();

// Track current speaker state
let speakerEnabled = false;
let audioRoutingPluginAvailable = false;
let AudioRoutingPlugin: any = null;

// Try to load the native plugin (if available)
async function loadNativePlugin() {
  if (!isNativePlatform) return false;
  
  try {
    // Try to dynamically register/access the plugin
    const { registerPlugin } = await import('@capacitor/core');
    AudioRoutingPlugin = registerPlugin('AudioRouting');
    audioRoutingPluginAvailable = true;
    console.log('✅ AudioRouting native plugin loaded');
    return true;
  } catch (error) {
    console.log('⚠️ AudioRouting native plugin not available - using fallback');
    audioRoutingPluginAvailable = false;
    return false;
  }
}

// Initialize plugin on load
loadNativePlugin();

/**
 * Initialize audio routing for a voice call
 * This sets up the audio session for voice communication (earpiece by default)
 */
export async function initCallAudio(): Promise<void> {
  console.log('📞 initCallAudio called');
  console.log('📞 isNativePlatform:', isNativePlatform);
  console.log('📞 platform:', currentPlatform);
  console.log('📞 pluginAvailable:', audioRoutingPluginAvailable);
  
  speakerEnabled = false;
  
  if (!isNativePlatform) {
    console.log('📞 Not native platform - audio routing not available');
    return;
  }

  // Try to use native plugin
  if (audioRoutingPluginAvailable && AudioRoutingPlugin) {
    try {
      await AudioRoutingPlugin.setVoiceCallMode();
      await AudioRoutingPlugin.setSpeakerOff();
      console.log('✅ Native call audio initialized - using earpiece');
      return;
    } catch (error) {
      console.warn('⚠️ Native plugin call failed:', error);
    }
  }

  // Fallback: Try using Web Audio API workarounds for Android WebView
  console.log('📞 Using fallback audio routing...');
  
  // On Android WebView, we can try to set audio attributes via the audio element
  // This is limited but might help in some cases
}

/**
 * Reset audio routing when call ends
 */
export async function resetCallAudio(): Promise<void> {
  console.log('📞 resetCallAudio called');
  speakerEnabled = false;
  
  if (!isNativePlatform) return;

  if (audioRoutingPluginAvailable && AudioRoutingPlugin) {
    try {
      await AudioRoutingPlugin.setDefaultMode();
      console.log('✅ Audio routing reset');
    } catch (error) {
      console.warn('⚠️ Reset audio failed:', error);
    }
  }
}

/**
 * Toggle speakerphone on/off
 * @returns Whether speaker is now enabled
 */
export async function toggleSpeaker(): Promise<boolean> {
  console.log('📞 toggleSpeaker called, current state:', speakerEnabled);
  
  if (!isNativePlatform) {
    // On web/non-native, just toggle state for UI purposes
    speakerEnabled = !speakerEnabled;
    console.log('📞 Speaker toggle (web):', speakerEnabled);
    return speakerEnabled;
  }

  if (audioRoutingPluginAvailable && AudioRoutingPlugin) {
    try {
      if (speakerEnabled) {
        await AudioRoutingPlugin.setSpeakerOff();
        speakerEnabled = false;
        console.log('📞 Speaker OFF - using earpiece');
      } else {
        await AudioRoutingPlugin.setSpeakerOn();
        speakerEnabled = true;
        console.log('📞 Speaker ON');
      }
      return speakerEnabled;
    } catch (error) {
      console.error('❌ Failed to toggle speaker:', error);
    }
  }
  
  // Fallback - just toggle state
  speakerEnabled = !speakerEnabled;
  console.log('📞 Speaker toggle (fallback):', speakerEnabled);
  return speakerEnabled;
}

/**
 * Set speaker state explicitly
 */
export async function setSpeaker(enabled: boolean): Promise<void> {
  console.log('📞 setSpeaker called:', enabled);
  
  if (!isNativePlatform) {
    speakerEnabled = enabled;
    return;
  }

  if (audioRoutingPluginAvailable && AudioRoutingPlugin) {
    try {
      if (enabled) {
        await AudioRoutingPlugin.setSpeakerOn();
      } else {
        await AudioRoutingPlugin.setSpeakerOff();
      }
      speakerEnabled = enabled;
      console.log('📞 Speaker set to:', enabled ? 'ON' : 'OFF');
    } catch (error) {
      console.error('❌ Failed to set speaker:', error);
      speakerEnabled = enabled;
    }
  } else {
    speakerEnabled = enabled;
  }
}

/**
 * Check if speaker is currently enabled
 */
export function isSpeakerEnabled(): boolean {
  return speakerEnabled;
}

/**
 * Check if running on native platform
 */
export function isNative(): boolean {
  return isNativePlatform;
}

/**
 * Get current platform
 */
export function getPlatform(): string {
  return currentPlatform;
}

export default {
  initCallAudio,
  resetCallAudio,
  toggleSpeaker,
  setSpeaker,
  isSpeakerEnabled,
  isNative,
  getPlatform,
};
