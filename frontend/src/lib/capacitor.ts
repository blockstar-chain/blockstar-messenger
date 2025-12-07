// frontend/src/lib/capacitor.ts
// Capacitor native plugins bridge for iOS and Android

import { Capacitor } from '@capacitor/core';
import { PushNotifications, Token, PushNotificationSchema, ActionPerformed } from '@capacitor/push-notifications';
import { App as CapacitorApp } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';
import { SplashScreen } from '@capacitor/splash-screen';

// API URL for backend
const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

// Check if running in native app
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'

// ============================================
// PUSH NOTIFICATIONS
// ============================================

export interface PushNotificationCallbacks {
  onRegistration?: (token: string) => void;
  onNotificationReceived?: (notification: PushNotificationSchema) => void;
  onNotificationAction?: (action: ActionPerformed) => void;
  onError?: (error: any) => void;
}

let pushCallbacks: PushNotificationCallbacks = {};

/**
 * Initialize push notifications for native platforms
 */
export async function initPushNotifications(
  walletAddress: any,
  callbacks?: PushNotificationCallbacks
): Promise<boolean> {
  if (!isNative) {
    console.log('Push notifications not available on web');
    return false;
  }

  pushCallbacks = callbacks || {};

  try {
    // Request permission
    let permStatus = await PushNotifications.checkPermissions();
    
    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== 'granted') {
      console.log('Push notification permission not granted');
      return false;
    }

    // Register for push notifications
    await PushNotifications.register();

    // Listen for registration
    PushNotifications.addListener('registration', async (token: Token) => {
      console.log('📱 Push token received:', token.value.substring(0, 20) + '...');
      
      // Send token to backend
      try {
        await fetch(`${API_URL}/api/push-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: token.value,
            walletAddress: walletAddress,
            platform: platform,
          }),
        });
        console.log('📱 Push token registered with server');
      } catch (error) {
        console.error('Failed to register push token:', error);
      }

      if (pushCallbacks.onRegistration) {
        pushCallbacks.onRegistration(token.value);
      }
    });

    // Listen for registration errors
    PushNotifications.addListener('registrationError', (error: any) => {
      console.error('Push registration error:', error);
      if (pushCallbacks.onError) {
        pushCallbacks.onError(error);
      }
    });

    // Listen for push notifications received
    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      console.log('📱 Push notification received:', notification);
      
      // Trigger haptic feedback
      hapticNotification();
      
      if (pushCallbacks.onNotificationReceived) {
        pushCallbacks.onNotificationReceived(notification);
      }
    });

    // Listen for notification actions (tapped)
    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      console.log('📱 Push notification action:', action);
      
      if (pushCallbacks.onNotificationAction) {
        pushCallbacks.onNotificationAction(action);
      }
    });

    return true;
  } catch (error) {
    console.error('Error initializing push notifications:', error);
    return false;
  }
}

/**
 * Unregister push token (for logout)
 */
export async function unregisterPushNotifications(
  walletAddress: string,
  token?: string
): Promise<void> {
  if (!isNative) return;

  try {
    // Remove token from backend
    if (token) {
      await fetch(`${API_URL}/api/push-token`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          walletAddress: walletAddress,
        }),
      });
    }

    // Remove listeners
    await PushNotifications.removeAllListeners();
  } catch (error) {
    console.error('Error unregistering push notifications:', error);
  }
}

// ============================================
// HAPTIC FEEDBACK
// ============================================

/**
 * Trigger light haptic feedback (for UI interactions)
 */
export async function hapticLight(): Promise<void> {
  if (!isNative) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch (error) {
    // Haptics not available
  }
}

/**
 * Trigger medium haptic feedback (for selections)
 */
export async function hapticMedium(): Promise<void> {
  if (!isNative) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch (error) {
    // Haptics not available
  }
}

/**
 * Trigger heavy haptic feedback (for important actions)
 */
export async function hapticHeavy(): Promise<void> {
  if (!isNative) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Heavy });
  } catch (error) {
    // Haptics not available
  }
}

/**
 * Trigger notification haptic (for notifications)
 */
export async function hapticNotification(): Promise<void> {
  if (!isNative) return;
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch (error) {
    // Haptics not available
  }
}

/**
 * Trigger error haptic
 */
export async function hapticError(): Promise<void> {
  if (!isNative) return;
  try {
    await Haptics.notification({ type: NotificationType.Error });
  } catch (error) {
    // Haptics not available
  }
}

// ============================================
// STATUS BAR
// ============================================

/**
 * Set status bar style
 */
export async function setStatusBarStyle(dark: boolean = true): Promise<void> {
  if (!isNative) return;
  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    
    if (platform === 'android') {
      await StatusBar.setBackgroundColor({ color: '#0a0a0f' });
    }
  } catch (error) {
    // Status bar not available
  }
}

/**
 * Hide status bar
 */
export async function hideStatusBar(): Promise<void> {
  if (!isNative) return;
  try {
    await StatusBar.hide();
  } catch (error) {
    // Status bar not available
  }
}

/**
 * Show status bar
 */
export async function showStatusBar(): Promise<void> {
  if (!isNative) return;
  try {
    await StatusBar.show();
  } catch (error) {
    // Status bar not available
  }
}

// ============================================
// KEYBOARD
// ============================================

export interface KeyboardCallbacks {
  onShow?: (height: number) => void;
  onHide?: () => void;
}

let keyboardCallbacks: KeyboardCallbacks = {};

/**
 * Initialize keyboard listeners
 */
export async function initKeyboard(callbacks?: KeyboardCallbacks): Promise<void> {
  if (!isNative) return;
  
  keyboardCallbacks = callbacks || {};

  try {
    Keyboard.addListener('keyboardWillShow', (info) => {
      if (keyboardCallbacks.onShow) {
        keyboardCallbacks.onShow(info.keyboardHeight);
      }
    });

    Keyboard.addListener('keyboardWillHide', () => {
      if (keyboardCallbacks.onHide) {
        keyboardCallbacks.onHide();
      }
    });
  } catch (error) {
    // Keyboard plugin not available
  }
}

/**
 * Hide keyboard
 */
export async function hideKeyboard(): Promise<void> {
  if (!isNative) return;
  try {
    await Keyboard.hide();
  } catch (error) {
    // Keyboard not available
  }
}

// ============================================
// APP LIFECYCLE
// ============================================

export interface AppLifecycleCallbacks {
  onResume?: () => void;
  onPause?: () => void;
  onBackButton?: () => boolean; // Return true to prevent default back
  onUrlOpen?: (url: string) => void;
}

let appCallbacks: AppLifecycleCallbacks = {};

/**
 * Initialize app lifecycle listeners
 */
export async function initAppLifecycle(callbacks?: AppLifecycleCallbacks): Promise<void> {
  if (!isNative) return;
  
  appCallbacks = callbacks || {};

  try {
    // App resume (foreground)
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && appCallbacks.onResume) {
        appCallbacks.onResume();
      } else if (!isActive && appCallbacks.onPause) {
        appCallbacks.onPause();
      }
    });

    // Back button (Android)
    CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (appCallbacks.onBackButton) {
        const handled = appCallbacks.onBackButton();
        if (!handled && canGoBack) {
          window.history.back();
        }
      } else if (canGoBack) {
        window.history.back();
      } else {
        CapacitorApp.exitApp();
      }
    });

    // Deep links
    CapacitorApp.addListener('appUrlOpen', (data) => {
      if (appCallbacks.onUrlOpen) {
        appCallbacks.onUrlOpen(data.url);
      }
    });
  } catch (error) {
    console.error('Error initializing app lifecycle:', error);
  }
}

// ============================================
// SPLASH SCREEN
// ============================================

/**
 * Hide splash screen
 */
export async function hideSplashScreen(): Promise<void> {
  if (!isNative) return;
  try {
    await SplashScreen.hide();
  } catch (error) {
    // Splash screen not available
  }
}

/**
 * Show splash screen
 */
export async function showSplashScreen(): Promise<void> {
  if (!isNative) return;
  try {
    await SplashScreen.show();
  } catch (error) {
    // Splash screen not available
  }
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize all native plugins
 */
export async function initNativePlugins(
  walletAddress?: string,
  callbacks?: {
    push?: PushNotificationCallbacks;
    keyboard?: KeyboardCallbacks;
    app?: AppLifecycleCallbacks;
  }
): Promise<void> {
  if (!isNative) {
    console.log('Not running in native app, skipping native plugin initialization');
    return;
  }

  console.log(`📱 Initializing native plugins for ${platform}...`);

  // Hide splash screen after a short delay
  setTimeout(() => hideSplashScreen(), 500);

  // Set status bar style
  await setStatusBarStyle(true);

  // Initialize keyboard
  await initKeyboard(callbacks?.keyboard);

  // Initialize app lifecycle
  await initAppLifecycle(callbacks?.app);

  // Initialize push notifications if wallet address provided
  if (walletAddress) {
    await initPushNotifications(walletAddress, callbacks?.push);
  }

  console.log('📱 Native plugins initialized');
}

// Export everything
export default {
  isNative,
  platform,
  // Push notifications
  initPushNotifications,
  unregisterPushNotifications,
  // Haptics
  hapticLight,
  hapticMedium,
  hapticHeavy,
  hapticNotification,
  hapticError,
  // Status bar
  setStatusBarStyle,
  hideStatusBar,
  showStatusBar,
  // Keyboard
  initKeyboard,
  hideKeyboard,
  // App lifecycle
  initAppLifecycle,
  // Splash screen
  hideSplashScreen,
  showSplashScreen,
  // Full initialization
  initNativePlugins,
};
