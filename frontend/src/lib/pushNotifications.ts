// frontend/src/lib/pushNotifications.ts
// Complete Push Notification Service for Capacitor Mobile App
// Handles token verification, re-registration, and retry logic

import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  Token,
  PushNotificationSchema,
  ActionPerformed
} from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';

// ============================================
// CONFIGURATION
// ============================================

const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

// Retry configuration
const PERMISSION_RETRY_DELAYS = [
  30 * 1000,      // 30 seconds
  2 * 60 * 1000,  // 2 minutes
  5 * 60 * 1000,  // 5 minutes
  15 * 60 * 1000, // 15 minutes
  60 * 60 * 1000, // 1 hour
];

// Storage keys
const STORAGE_KEYS = {
  PUSH_TOKEN: 'blockstar_push_token',
  PERMISSION_DENIED_COUNT: 'blockstar_push_permission_denied_count',
  LAST_PERMISSION_REQUEST: 'blockstar_push_last_permission_request',
  TOKEN_REGISTERED: 'blockstar_push_token_registered',
};

// Platform detection
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'

// ============================================
// TYPES
// ============================================

export interface IncomingCallData {
  callId: string;
  callerId: string;
  callerName: string;
  callerAvatar: string;
  callType: 'voice' | 'video';
  conversationId: string;
}

export interface MessageNotificationData {
  senderId: string;
  senderName: string;
  messagePreview: string;
  conversationId: string;
}

export interface PushNotificationCallbacks {
  onIncomingCall?: (data: IncomingCallData) => void;
  onMessage?: (data: MessageNotificationData) => void;
  onMissedCall?: (data: { callerName: string; callType: string }) => void;
  onNotificationTapped?: (data: any) => void;
  onTokenRegistered?: (token: string) => void;
  onPermissionDenied?: () => void;
}

export interface TokenStatus {
  hasToken: boolean;
  tokenCount: number;
  platforms: string[];
}

// ============================================
// STATE
// ============================================

let callbacks: PushNotificationCallbacks = {};
let currentPushToken: string | null = null;
let isInitialized = false;
let currentWalletAddress: string | null = null;
let permissionRetryTimer: NodeJS.Timeout | null = null;
let isRequestingPermission = false;

// ============================================
// STORAGE HELPERS
// ============================================

function getStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors
  }
}

function removeStorageItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage errors
  }
}

// ============================================
// TOKEN VERIFICATION
// ============================================

/**
 * Check if push token exists in the backend database
 */
export async function checkTokenExists(walletAddress: string): Promise<TokenStatus> {
  try {
    const response = await fetch(`${API_URL}/api/push-token/check/${walletAddress.toLowerCase()}`);

    if (!response.ok) {
      console.error('❌ Failed to check token status:', response.status);
      return { hasToken: false, tokenCount: 0, platforms: [] };
    }

    const data = await response.json();

    console.log('📱 Token check result:', data);

    return {
      hasToken: data.hasToken || false,
      tokenCount: data.tokenCount || 0,
      platforms: data.platforms || [],
    };
  } catch (error) {
    console.error('❌ Error checking token status:', error);
    return { hasToken: false, tokenCount: 0, platforms: [] };
  }
}

/**
 * Force register token with backend (clears old tokens first)
 */
async function forceRegisterToken(
  token: string,
  walletAddress: string
): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/push-token/force-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        walletAddress: walletAddress.toLowerCase(),
        platform,
      }),
    });

    if (response.ok) {
      console.log('✅ Push token force-registered with server');
      setStorageItem(STORAGE_KEYS.TOKEN_REGISTERED, 'true');
      return true;
    } else {
      const error = await response.json();
      console.error('❌ Failed to force-register token:', error);
      return false;
    }
  } catch (error) {
    console.error('❌ Error force-registering token:', error);
    return false;
  }
}

// ============================================
// PERMISSION HANDLING
// ============================================

/**
 * Get the number of times permission has been denied
 */
function getPermissionDeniedCount(): number {
  const count = getStorageItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT);
  return count ? parseInt(count, 10) : 0;
}

/**
 * Increment permission denied count
 */
function incrementPermissionDeniedCount(): number {
  const count = getPermissionDeniedCount() + 1;
  setStorageItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT, count.toString());
  setStorageItem(STORAGE_KEYS.LAST_PERMISSION_REQUEST, Date.now().toString());
  return count;
}

/**
 * Reset permission denied count (call when permission is granted)
 */
function resetPermissionDeniedCount(): void {
  removeStorageItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT);
  removeStorageItem(STORAGE_KEYS.LAST_PERMISSION_REQUEST);
}

/**
 * Check if we should retry requesting permission
 */
function shouldRetryPermission(): boolean {
  const deniedCount = getPermissionDeniedCount();
  const lastRequest = getStorageItem(STORAGE_KEYS.LAST_PERMISSION_REQUEST);

  if (deniedCount >= PERMISSION_RETRY_DELAYS.length) {
    // Max retries reached, check if 24 hours have passed
    if (lastRequest) {
      const elapsed = Date.now() - parseInt(lastRequest, 10);
      return elapsed > 24 * 60 * 60 * 1000; // 24 hours
    }
    return false;
  }

  if (!lastRequest) return true;

  const elapsed = Date.now() - parseInt(lastRequest, 10);
  const requiredDelay = PERMISSION_RETRY_DELAYS[deniedCount] || PERMISSION_RETRY_DELAYS[PERMISSION_RETRY_DELAYS.length - 1];

  return elapsed >= requiredDelay;
}

/**
 * Get time until next retry in milliseconds
 */
function getTimeUntilNextRetry(): number {
  const deniedCount = getPermissionDeniedCount();
  const lastRequest = getStorageItem(STORAGE_KEYS.LAST_PERMISSION_REQUEST);

  if (!lastRequest) return 0;

  const elapsed = Date.now() - parseInt(lastRequest, 10);
  const requiredDelay = deniedCount < PERMISSION_RETRY_DELAYS.length
    ? PERMISSION_RETRY_DELAYS[deniedCount]
    : 24 * 60 * 60 * 1000; // 24 hours after max retries

  return Math.max(0, requiredDelay - elapsed);
}

/**
 * Schedule retry for permission request
 */
function schedulePermissionRetry(walletAddress: string): void {
  if (permissionRetryTimer) {
    clearTimeout(permissionRetryTimer);
  }

  const timeUntilRetry = getTimeUntilNextRetry();

  if (timeUntilRetry > 0) {
    console.log(`📱 Scheduling permission retry in ${Math.round(timeUntilRetry / 1000)}s`);

    permissionRetryTimer = setTimeout(() => {
      console.log('📱 Retrying push notification permission...');
      requestPushPermission(walletAddress);
    }, timeUntilRetry);
  }
}

/**
 * Request push notification permission
 */
async function requestPushPermission(walletAddress: string): Promise<boolean> {
  if (isRequestingPermission) {
    console.log('📱 Permission request already in progress');
    return false;
  }

  isRequestingPermission = true;

  try {
    let permStatus = await PushNotifications.checkPermissions();
    console.log('📱 Current permission status:', permStatus.receive);

    if (permStatus.receive === 'granted') {
      resetPermissionDeniedCount();
      isRequestingPermission = false;
      return true;
    }

    if (permStatus.receive === 'denied') {
      // Permission was previously denied
      if (!shouldRetryPermission()) {
        console.log('📱 Permission denied, waiting before retry...');
        schedulePermissionRetry(walletAddress);
        isRequestingPermission = false;

        if (callbacks.onPermissionDenied) {
          callbacks.onPermissionDenied();
        }

        return false;
      }
    }

    // Request permission
    console.log('📱 Requesting push notification permission...');
    permStatus = await PushNotifications.requestPermissions();

    if (permStatus.receive === 'granted') {
      console.log('✅ Push notification permission GRANTED');
      resetPermissionDeniedCount();
      isRequestingPermission = false;
      return true;
    } else {
      console.log('❌ Push notification permission DENIED');
      const deniedCount = incrementPermissionDeniedCount();
      console.log(`📱 Permission denied ${deniedCount} time(s)`);

      schedulePermissionRetry(walletAddress);

      if (callbacks.onPermissionDenied) {
        callbacks.onPermissionDenied();
      }

      isRequestingPermission = false;
      return false;
    }
  } catch (error) {
    console.error('❌ Error requesting permission:', error);
    isRequestingPermission = false;
    return false;
  }
}


// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize push notifications for the mobile app
 * Call this when user logs in with their wallet
 * 
 * This function will:
 * 1. Check if a token exists in the database
 * 2. Request permission if needed
 * 3. Register or re-register the token
 */

async function debug(message: any, extra?: any) {
  try {
    console.log('hererererere in debug')
    const payload = {
      message: String(message),
      extra: extra ?? null,
      timestamp: new Date().toISOString(),
      platform: Capacitor.getPlatform(),
    };

    await fetch(`${API_URL}/api/debug-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e :any) {
    console.log('debug e => ' , e.message)
    // Avoid infinite recursion if debug endpoint is unreachable
  }
}
export async function initializePushNotifications(
  walletAddress: string,
  notificationCallbacks?: PushNotificationCallbacks
): Promise<boolean> {
  debug("Initializing push notifications for wallet: " + walletAddress);
  debug("API_URL used: " + API_URL);

  if (!isNative) {
    debug("Push notifications not available on web");
    console.log('Push notifications not available on web');
    return false;
  }

  callbacks = notificationCallbacks || {};

  try {
    // Request permission and WAIT for user response
    let permStatus = await PushNotifications.checkPermissions();
    
    debug('Initial permission status: ' + permStatus.receive);
    
    if (permStatus.receive === 'prompt') {
      debug('Requesting permissions...');
      // This will show the permission dialog and WAIT for user response
      permStatus = await PushNotifications.requestPermissions();
      debug('Permission response received: ' + permStatus.receive);
    }

    // Now check the FINAL permission status after user responded
    if (permStatus.receive !== 'granted') {
      console.log('Push notification permission not granted');
      debug('Push notification permission not granted. Status: ' + permStatus.receive);
      return false;
    }

    debug('✅ Permission granted! Setting up listeners...');

    // NOW set up listeners (after permission is granted)
    PushNotifications.addListener('registration', async (token: Token) => {
      console.log('📱 Push token received:', token.value.substring(0, 20) + '...');
      debug('📱 Push token received: ' + token.value.substring(0, 20) + '...');

      // Send token to backend
      try {
        const response = await fetch(`${API_URL}/api/push-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: token.value,
            walletAddress: walletAddress,
            platform: platform,
          }),
        });

        if (response.ok) {
          console.log('📱 Push token registered with server');
          debug('✅ Push token registered with server');
        } else {
          console.error('Failed to register token, status:', response.status);
          debug('❌ Failed to register token, status: ' + response.status);
        }
      } catch (error) {
        console.error('Failed to register push token:', error);
        debug('❌ Failed to register push token: ' + (error as Error).message);
      }
    });

    // Listen for registration errors
    PushNotifications.addListener('registrationError', (error: any) => {
      console.error('❌ Push registration error:', error);
      debug('❌ Push registration error: ' + JSON.stringify(error));
      removeStorageItem(STORAGE_KEYS.TOKEN_REGISTERED);
    });

    // Listen for push notifications received (foreground)
    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      console.log('📱 ════════════════════════════════════════════════');
      console.log('📱 PUSH NOTIFICATION RECEIVED (Foreground)');
      console.log('📱 Title:', notification.title);
      console.log('📱 Body:', notification.body);
      console.log('📱 Data:', JSON.stringify(notification.data, null, 2));
      console.log('📱 ════════════════════════════════════════════════');
      
      debug('📱 Foreground notification: ' + notification.title);
      handleNotificationData(notification.data, false);
    });

    // Listen for notification actions (when user taps notification)
    PushNotifications.addListener('pushNotificationActionPerformed', (notification: ActionPerformed) => {
      console.log('📱 Push notification action performed:', notification.actionId);
      debug('📱 Notification tapped: ' + notification.actionId);
      handleNotificationData(notification.notification.data, true);
    });

    debug('📱 Registering for push notifications...');
    
    // Register for push notifications
    await PushNotifications.register();
    
    debug('✅ Registration initiated successfully');
    console.log('✅ Push notification setup complete');
    
    return true;

  } catch (error: any) {
    debug("❌ Failed to initialize push notifications: " + error.message);
    console.error('Error initializing push notifications:', error);
    return false;
  }
}

/**
 * Check and ensure push notifications are properly registered
 * Call this on app resume/foreground to verify token is still valid
 */
export async function verifyPushRegistration(walletAddress: string): Promise<boolean> {
  if (!isNative) return false;

  console.log('📱 Verifying push registration...');

  try {
    // Check if token exists in backend
    const tokenStatus = await checkTokenExists(walletAddress);

    if (!tokenStatus.hasToken || !tokenStatus.platforms.includes(platform)) {
      console.log('📱 Token missing from backend - re-registering...');

      // Re-initialize to get new token
      return await initializePushNotifications(walletAddress, callbacks);
    }

    console.log('✅ Push registration verified');
    return true;
  } catch (error) {
    console.error('❌ Error verifying push registration:', error);
    return false;
  }
}

// ============================================
// LISTENERS
// ============================================

/**
 * Set up push notification listeners
 */
async function setupPushListeners(
  walletAddress: string,
  forceRegister: boolean
): Promise<void> {
  // Remove any existing listeners
  await PushNotifications.removeAllListeners();

  // ─────────────────────────────────────────
  // Registration Success
  // ─────────────────────────────────────────
  PushNotifications.addListener('registration', async (token: Token) => {
    console.log('📱 ════════════════════════════════════════════════');
    console.log('📱 PUSH TOKEN RECEIVED');
    console.log('📱 Token:', token.value.substring(0, 40) + '...');
    console.log('📱 ════════════════════════════════════════════════');

    currentPushToken = token.value;

    // Save token locally
    setStorageItem(STORAGE_KEYS.PUSH_TOKEN, token.value);

    // Register with backend
    try {
      let success: boolean;

      if (forceRegister) {
        // Force register - clears old tokens
        success = await forceRegisterToken(token.value, walletAddress);
      } else {
        // Normal register
        const response = await fetch(`${API_URL}/api/push-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: token.value,
            walletAddress: walletAddress.toLowerCase(),
            platform,
          }),
        });

        success = response.ok;

        if (success) {
          console.log('✅ Push token registered with server');
          setStorageItem(STORAGE_KEYS.TOKEN_REGISTERED, 'true');
        } else {
          const error = await response.json();
          console.error('❌ Failed to register token:', error);
        }
      }

      if (success && callbacks.onTokenRegistered) {
        callbacks.onTokenRegistered(token.value);
      }
    } catch (error) {
      console.error('❌ Error sending token to server:', error);
    }
  });

  // ─────────────────────────────────────────
  // Registration Error
  // ─────────────────────────────────────────
  PushNotifications.addListener('registrationError', (error: any) => {
    console.error('❌ Push registration error:', error);

    // Clear stored token since registration failed
    removeStorageItem(STORAGE_KEYS.TOKEN_REGISTERED);
  });

  // ─────────────────────────────────────────
  // Notification Received (App in Foreground)
  // ─────────────────────────────────────────
  PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
    console.log('📱 ════════════════════════════════════════════════');
    console.log('📱 PUSH NOTIFICATION RECEIVED (Foreground)');
    console.log('📱 Title:', notification.title);
    console.log('📱 Body:', notification.body);
    console.log('📱 Data:', JSON.stringify(notification.data, null, 2));
    console.log('📱 ════════════════════════════════════════════════');

    handleNotificationData(notification.data, false);
  });

  // ─────────────────────────────────────────
  // Notification Tapped (App was Background/Closed)
  // ─────────────────────────────────────────
  PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
    console.log('📱 ════════════════════════════════════════════════');
    console.log('📱 PUSH NOTIFICATION TAPPED');
    console.log('📱 Action:', action.actionId);
    console.log('📱 Data:', JSON.stringify(action.notification.data, null, 2));
    console.log('📱 ════════════════════════════════════════════════');

    handleNotificationData(action.notification.data, true);

    if (callbacks.onNotificationTapped) {
      callbacks.onNotificationTapped(action.notification.data);
    }
  });
}

// ============================================
// NOTIFICATION HANDLING
// ============================================

/**
 * Process incoming notification data
 */
function handleNotificationData(data: any, wasTapped: boolean): void {
  if (!data) {
    console.log('📱 Empty notification data');
    return;
  }

  const notificationType = data.type;
  console.log('📱 Notification type:', notificationType);

  switch (notificationType) {
    case 'incoming_call':
      handleIncomingCall(data);
      break;

    case 'message':
      handleMessageNotification(data);
      break;

    case 'missed_call':
      handleMissedCall(data);
      break;

    case 'call_cancelled':
      console.log('📴 Call was cancelled');
      break;

    case 'test':
      console.log('🧪 Test notification received!');
      break;

    default:
      console.log('📱 Unknown notification type:', notificationType);
  }
}

/**
 * Handle incoming call notification
 */
function handleIncomingCall(data: any): void {
  console.log('📞 ════════════════════════════════════════════════');
  console.log('📞 INCOMING CALL FROM PUSH NOTIFICATION');
  console.log('📞 Caller:', data.callerName || data.caller);
  console.log('📞 Type:', data.callType);
  console.log('📞 ════════════════════════════════════════════════');

  const callData: IncomingCallData = {
    callId: data.callId || `call-${Date.now()}`,
    callerId: data.callerId,
    callerName: data.callerName || data.caller || 'Unknown Caller',
    callerAvatar: data.callerAvatar || '',
    callType: data.callType || 'voice',
    conversationId: data.conversationId,
  };

  // Trigger the incoming call callback
  if (callbacks.onIncomingCall) {
    console.log('📞 Triggering onIncomingCall callback');
    callbacks.onIncomingCall(callData);
  } else {
    console.warn('⚠️ No onIncomingCall callback registered!');
    showLocalCallNotification(callData);
  }
}

/**
 * Handle message notification
 */
function handleMessageNotification(data: any): void {
  console.log('💬 Message notification received');

  if (callbacks.onMessage) {
    callbacks.onMessage({
      senderId: data.senderId,
      senderName: data.senderName || data.title || 'New Message',
      messagePreview: data.body || data.messagePreview || '',
      conversationId: data.conversationId,
    });
  }
}

/**
 * Handle missed call notification
 */
function handleMissedCall(data: any): void {
  console.log('📵 Missed call notification received');

  if (callbacks.onMissedCall) {
    callbacks.onMissedCall({
      callerName: data.callerName,
      callType: data.callType,
    });
  }
}

// ============================================
// LOCAL NOTIFICATIONS
// ============================================

/**
 * Set up local notifications (for Android channels and fallback)
 */
async function setupLocalNotifications(): Promise<void> {
  try {
    // Request permission
    const permission = await LocalNotifications.requestPermissions();
    console.log('📱 Local notification permission:', permission.display);

    // Create notification channels for Android
    if (platform === 'android') {
      // Calls channel - MAX priority
      await LocalNotifications.createChannel({
        id: 'calls',
        name: 'Incoming Calls',
        description: 'Notifications for incoming voice and video calls',
        importance: 5, // MAX importance
        visibility: 1, // PUBLIC
        sound: 'ringtone.wav',
        vibration: true,
        lights: true,
        lightColor: '#3b82f6',
      });

      // Messages channel - HIGH priority
      await LocalNotifications.createChannel({
        id: 'messages',
        name: 'Messages',
        description: 'Notifications for new messages',
        importance: 4, // HIGH
        sound: 'message.wav',
        vibration: true,
      });

      // Missed calls channel
      await LocalNotifications.createChannel({
        id: 'missed_calls',
        name: 'Missed Calls',
        description: 'Notifications for missed calls',
        importance: 4, // HIGH
        vibration: true,
      });

      console.log('✅ Android notification channels created');
    }
  } catch (error) {
    console.error('❌ Error setting up local notifications:', error);
  }
}

/**
 * Show a local notification for incoming call (fallback)
 */
async function showLocalCallNotification(callData: IncomingCallData): Promise<void> {
  console.log('📱 Showing local call notification as fallback');

  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Date.now(),
          title: `Incoming ${callData.callType} call`,
          body: `${callData.callerName} is calling you`,
          channelId: 'calls',
          ongoing: true,
          autoCancel: false,
          extra: {
            type: 'incoming_call',
            ...callData,
          },
        },
      ],
    });
  } catch (error) {
    console.error('❌ Error showing local notification:', error);
  }
}

// ============================================
// CLEANUP
// ============================================

/**
 * Unregister push notifications (call on logout)
 */
export async function unregisterPushNotifications(): Promise<void> {
  if (!isNative || !currentPushToken || !currentWalletAddress) {
    return;
  }

  console.log('📱 Unregistering push notifications...');

  // Cancel any pending retry timers
  if (permissionRetryTimer) {
    clearTimeout(permissionRetryTimer);
    permissionRetryTimer = null;
  }

  try {
    // Remove token from server
    await fetch(`${API_URL}/api/push-token`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: currentPushToken,
        walletAddress: currentWalletAddress,
      }),
    });
    console.log('✅ Push token removed from server');
  } catch (error) {
    console.error('❌ Error removing push token:', error);
  }

  // Remove listeners
  await PushNotifications.removeAllListeners();

  // Clear storage
  removeStorageItem(STORAGE_KEYS.PUSH_TOKEN);
  removeStorageItem(STORAGE_KEYS.TOKEN_REGISTERED);

  // Reset state
  currentPushToken = null;
  currentWalletAddress = null;
  isInitialized = false;
  callbacks = {};

  console.log('📱 Push notifications unregistered');
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Update notification callbacks
 */
export function updatePushCallbacks(newCallbacks: PushNotificationCallbacks): void {
  callbacks = { ...callbacks, ...newCallbacks };
  console.log('📱 Push notification callbacks updated');
}

/**
 * Get current push token
 */
export function getPushToken(): string | null {
  return currentPushToken;
}

/**
 * Check if push notifications are initialized
 */
export function isPushInitialized(): boolean {
  return isInitialized;
}

/**
 * Get current wallet address
 */
export function getCurrentWallet(): string | null {
  return currentWalletAddress;
}

/**
 * Manually trigger permission request retry
 */
export async function retryPermissionRequest(): Promise<boolean> {
  if (!currentWalletAddress) {
    console.error('❌ No wallet address set');
    return false;
  }

  // Reset denied count to allow immediate retry
  resetPermissionDeniedCount();

  return requestPushPermission(currentWalletAddress);
}

/**
 * Test push notification (for debugging)
 */
export async function testPushNotification(): Promise<boolean> {
  if (!currentWalletAddress) {
    console.error('❌ No wallet address set');
    return false;
  }

  try {
    const response = await fetch(`${API_URL}/api/push-token/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: currentWalletAddress }),
    });

    const result = await response.json();
    console.log('🧪 Test notification result:', result);
    return result.success;
  } catch (error) {
    console.error('❌ Test notification failed:', error);
    return false;
  }
}

/**
 * Check push notification status
 */
export async function checkPushStatus(): Promise<{
  enabled: boolean;
  tokenCount: number;
  firebaseReady: boolean;
} | null> {
  if (!currentWalletAddress) {
    return null;
  }

  try {
    const response = await fetch(
      `${API_URL}/api/push-token/status/${currentWalletAddress}`
    );
    return await response.json();
  } catch (error) {
    console.error('❌ Error checking push status:', error);
    return null;
  }
}

/**
 * Get permission status info
 */
export function getPermissionInfo(): {
  deniedCount: number;
  canRetryNow: boolean;
  timeUntilRetry: number;
} {
  return {
    deniedCount: getPermissionDeniedCount(),
    canRetryNow: shouldRetryPermission(),
    timeUntilRetry: getTimeUntilNextRetry(),
  };
}
