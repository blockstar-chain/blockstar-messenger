// frontend/src/lib/mediaPermissions.ts
// Media permissions service for audio/video calls on web and native Capacitor apps

import { Capacitor } from '@capacitor/core';

export interface PermissionStatus {
  microphone: 'granted' | 'denied' | 'prompt' | 'unavailable';
  camera: 'granted' | 'denied' | 'prompt' | 'unavailable';
}

export interface PermissionResult {
  success: boolean;
  microphone: boolean;
  camera: boolean;
  error?: string;
}

const isNative = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform();

/**
 * Check current permission status for microphone and camera
 */
export async function checkMediaPermissions(): Promise<PermissionStatus> {
  const result: PermissionStatus = {
    microphone: 'unavailable',
    camera: 'unavailable',
  };

  try {
    // Check if permissions API is available
    if ('permissions' in navigator) {
      try {
        const micPermission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        result.microphone = micPermission.state as 'granted' | 'denied' | 'prompt';
      } catch (e) {
        // Some browsers don't support microphone permission query
        result.microphone = 'prompt';
      }

      try {
        const camPermission = await navigator.permissions.query({ name: 'camera' as PermissionName });
        result.camera = camPermission.state as 'granted' | 'denied' | 'prompt';
      } catch (e) {
        // Some browsers don't support camera permission query
        result.camera = 'prompt';
      }
    } else {
      // Permissions API not available, assume prompt
      result.microphone = 'prompt';
      result.camera = 'prompt';
    }
  } catch (error) {
    console.error('Error checking media permissions:', error);
    result.microphone = 'prompt';
    result.camera = 'prompt';
  }

  return result;
}

/**
 * Request microphone permission
 * On native apps, this will trigger the native permission dialog
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  console.log('📱 Requesting microphone permission...');
  console.log('📱 Platform:', platform, 'isNative:', isNative);

  try {
    // On native platforms, we need to request a temporary stream to trigger the permission dialog
    // This is the standard way to request media permissions in WebViews
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: true,
      video: false 
    });
    
    // Permission granted - stop the stream immediately
    stream.getTracks().forEach(track => track.stop());
    console.log('✅ Microphone permission granted');
    return true;
  } catch (error: any) {
    console.error('❌ Microphone permission error:', error.name, error.message);
    
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      console.log('❌ Microphone permission denied by user');
      return false;
    }
    
    if (error.name === 'NotFoundError') {
      console.log('❌ No microphone device found');
      return false;
    }
    
    // Other errors
    return false;
  }
}

/**
 * Request camera permission
 * On native apps, this will trigger the native permission dialog
 */
export async function requestCameraPermission(): Promise<boolean> {
  console.log('📱 Requesting camera permission...');
  console.log('📱 Platform:', platform, 'isNative:', isNative);

  try {
    // Request camera only to trigger the permission dialog
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: false,
      video: true 
    });
    
    // Permission granted - stop the stream immediately
    stream.getTracks().forEach(track => track.stop());
    console.log('✅ Camera permission granted');
    return true;
  } catch (error: any) {
    console.error('❌ Camera permission error:', error.name, error.message);
    
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      console.log('❌ Camera permission denied by user');
      return false;
    }
    
    if (error.name === 'NotFoundError') {
      console.log('❌ No camera device found');
      return false;
    }
    
    return false;
  }
}

/**
 * Request all necessary permissions for a call
 * @param includeVideo - Whether to also request camera permission
 * @returns PermissionResult indicating which permissions were granted
 */
export async function requestCallPermissions(includeVideo: boolean = false): Promise<PermissionResult> {
  console.log('========================================');
  console.log('📱 REQUESTING CALL PERMISSIONS');
  console.log('📱 Include video:', includeVideo);
  console.log('📱 Platform:', platform);
  console.log('📱 Is native:', isNative);
  console.log('========================================');

  const result: PermissionResult = {
    success: false,
    microphone: false,
    camera: false,
  };

  // First, request microphone permission (required for all calls)
  result.microphone = await requestMicrophonePermission();
  
  if (!result.microphone) {
    result.error = 'Microphone permission denied. Please allow microphone access in your device settings to make calls.';
    return result;
  }

  // If video call, also request camera permission
  if (includeVideo) {
    result.camera = await requestCameraPermission();
    
    if (!result.camera) {
      // Camera denied but microphone granted - can still do audio-only
      console.log('⚠️ Camera denied, but can proceed with audio-only');
      result.error = 'Camera permission denied. The call will be audio-only.';
      // Still mark as success since audio works
      result.success = true;
      return result;
    }
  }

  result.success = true;
  console.log('✅ All required permissions granted');
  return result;
}

/**
 * Check if we have the minimum required permissions for a call
 */
export async function hasCallPermissions(includeVideo: boolean = false): Promise<boolean> {
  const status = await checkMediaPermissions();
  
  // Must have microphone permission
  if (status.microphone === 'denied') {
    return false;
  }
  
  // For video calls, also need camera
  if (includeVideo && status.camera === 'denied') {
    return false;
  }
  
  return true;
}

/**
 * Get a user-friendly message for permission errors
 */
export function getPermissionErrorMessage(error: any): string {
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
    if (isNative) {
      if (platform === 'android') {
        return 'Microphone permission denied. Please go to Settings > Apps > BlockStar > Permissions and enable Microphone access.';
      } else if (platform === 'ios') {
        return 'Microphone permission denied. Please go to Settings > BlockStar and enable Microphone access.';
      }
    }
    return 'Microphone permission denied. Please allow microphone access in your browser settings.';
  }
  
  if (error.name === 'NotFoundError') {
    return 'No microphone found. Please connect a microphone and try again.';
  }
  
  if (error.name === 'NotReadableError') {
    return 'Microphone is in use by another app. Please close other apps using the microphone and try again.';
  }
  
  if (error.name === 'AbortError') {
    return 'Microphone access was interrupted. Please try again.';
  }
  
  if (error.name === 'SecurityError') {
    return 'Microphone access is blocked due to security settings.';
  }
  
  return `Microphone error: ${error.message || 'Unknown error'}`;
}

/**
 * Show native settings for the app (to manually enable permissions)
 * Note: This opens the app's settings page on supported platforms
 */
export function openAppSettings(): void {
  if (isNative) {
    // On native platforms, we can try to open app settings
    // This requires the @capacitor/app plugin which is already installed
    try {
      // Dynamically import to avoid issues on web
      import('@capacitor/app').then(({ App }) => {
        // On Android, this opens the app details page in settings
        // On iOS, this opens the Settings app
        if (platform === 'android') {
          // Try to open Android app settings
          (window as any).open('app-settings:');
        }
      }).catch(() => {
        console.log('Could not open app settings');
      });
    } catch (e) {
      console.log('Could not open app settings:', e);
    }
  }
}

export default {
  checkMediaPermissions,
  requestMicrophonePermission,
  requestCameraPermission,
  requestCallPermissions,
  hasCallPermissions,
  getPermissionErrorMessage,
  openAppSettings,
  isNative,
  platform,
};
