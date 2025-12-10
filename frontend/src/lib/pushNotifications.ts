// frontend/src/lib/pushNotifications.ts
// Complete Push Notification Service for Capacitor Mobile App
// Handles incoming calls even when app is closed

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
}

// ============================================
// STATE
// ============================================

let callbacks: PushNotificationCallbacks = {};
let currentPushToken: string | null = null;
let isInitialized = false;
let currentWalletAddress: string | null = null;

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize push notifications for the mobile app
 * Call this when user logs in with their wallet
 */
export async function initializePushNotifications(
  walletAddress: string,
  notificationCallbacks?: PushNotificationCallbacks
): Promise<boolean> {
  // Only works on native platforms
  if (!isNative) {
    console.log('📱 Push notifications not available on web platform');
    return false;
  }

  // Already initialized for this wallet
  if (isInitialized && currentWalletAddress === walletAddress) {
    console.log('📱 Push notifications already initialized');
    if (notificationCallbacks) {
      callbacks = { ...callbacks, ...notificationCallbacks };
    }
    return true;
  }

  console.log('📱 ════════════════════════════════════════════════');
  console.log('📱 INITIALIZING PUSH NOTIFICATIONS');
  console.log('📱 Platform:', platform);
  console.log('📱 Wallet:', walletAddress);
  console.log('📱 ════════════════════════════════════════════════');

  callbacks = notificationCallbacks || {};
  currentWalletAddress = walletAddress;

  try {
    // Step 1: Check/request permissions
    let permStatus = await PushNotifications.checkPermissions();
    console.log('📱 Current permission:', permStatus.receive);

    if (permStatus.receive === 'prompt') {
      console.log('📱 Requesting permission...');
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== 'granted') {
      console.error('❌ Push notification permission DENIED');
      return false;
    }

    console.log('✅ Push notification permission GRANTED');

    // Step 2: Set up listeners BEFORE registering
    await setupPushListeners(walletAddress);

    // Step 3: Register for push notifications
    await PushNotifications.register();

    // Step 4: Set up local notifications for Android channels
    await setupLocalNotifications();

    isInitialized = true;
    console.log('✅ Push notifications initialized successfully');
    return true;

  } catch (error) {
    console.error('❌ Error initializing push notifications:', error);
    return false;
  }
}

// ============================================
// LISTENERS
// ============================================

/**
 * Set up push notification listeners
 */
async function setupPushListeners(walletAddress: string): Promise<void> {
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
    alert(`Token = ${ token.value}`)
    currentPushToken = token.value;

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

      alert(`response API = ${ response}`)
      alert(`${API_URL}/api/push-token`)

      if (response.ok) {
        console.log('✅ Push token registered with server');
      } else {
        const error = await response.json();
        console.error('❌ Failed to register token:', error);
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
    case 'call':
      handleIncomingCall(data);
      break;

    case 'message':
      handleMessageNotification(data);
      break;

    case 'missed_call':
      handleMissedCall(data);
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
  console.log('📞 Caller:', data.callerName);
  console.log('📞 Type:', data.callType);
  console.log('📞 ════════════════════════════════════════════════');

  const callData: IncomingCallData = {
    callId: data.callId || `call-${Date.now()}`,
    callerId: data.callerId,
    callerName: data.callerName || 'Unknown Caller',
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
    console.warn('⚠️ Make sure to pass onIncomingCall when initializing');
    
    // Show local notification as fallback
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
      // Calls channel - HIGH priority
      await LocalNotifications.createChannel({
        id: 'calls',
        name: 'Incoming Calls',
        description: 'Notifications for incoming voice and video calls',
        importance: 5, // MAX importance (heads-up notification)
        visibility: 1, // PUBLIC
        sound: 'ringtone.wav',
        vibration: true,
        lights: true,
        lightColor: '#3b82f6',
      });

      // Messages channel
      await LocalNotifications.createChannel({
        id: 'messages',
        name: 'Messages',
        description: 'Notifications for new messages',
        importance: 4, // HIGH
        sound: 'message.wav',
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
            type: 'call',
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
