// backend/src/services/pushNotificationService.ts
// Push notification service for iOS (APNs + FCM) and Android (FCM)
// iOS: Uses native APNs first, falls back to FCM
// Android: Uses FCM with high-priority notifications to wake devices

import admin from 'firebase-admin';
import apn from 'apn';

// ═══════════════════════════════════════════════════════════════
// FIREBASE CLOUD MESSAGING (FCM) INITIALIZATION
// ═══════════════════════════════════════════════════════════════

let firebaseInitialized = false;

export function initializeFirebase(): boolean {
  if (firebaseInitialized) return true;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.warn('⚠️  Firebase credentials not configured. Push notifications disabled.');
    console.warn('   Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY');
    return false;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });

    firebaseInitialized = true;
    console.log('🔥 Firebase Admin SDK initialized');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Firebase:', error);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// APPLE PUSH NOTIFICATION SERVICE (APNs) INITIALIZATION
// ═══════════════════════════════════════════════════════════════

let apnProvider: apn.Provider | null = null;

export function initializeAPNs(): boolean {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const keyPath = process.env.APNS_KEY_PATH;
  const bundleId = process.env.APNS_BUNDLE_ID;

  if (!keyId || !teamId || !keyPath || !bundleId) {
    console.warn('⚠️  APNs credentials not configured. iOS native push disabled.');
    console.warn('   Set APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_PATH, and APNS_BUNDLE_ID');
    return false;
  }

  try {
    apnProvider = new apn.Provider({
      token: {
        key: keyPath,
        keyId: keyId,
        teamId: teamId,
      },
      production: process.env.NODE_ENV === 'production',
    });

    console.log('🍎 APNs Provider initialized');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize APNs:', error);
    return false;
  }
}

/**
 * Initialize all push notification services
 * Call this on server startup
 */
export function initializePushServices(): boolean {
  const fcmInit = initializeFirebase();
  const apnsInit = initializeAPNs();
  
  if (!fcmInit && !apnsInit) {
    console.error('❌ No push notification services initialized!');
    return false;
  }
  
  return true;
}

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
}

export interface CallPushPayload {
  callId: string;
  callerId: string;
  callerName?: string;
  callType: 'audio' | 'video';
}

// ═══════════════════════════════════════════════════════════════
// NATIVE APNs FUNCTIONS (iOS)
// ═══════════════════════════════════════════════════════════════

/**
 * Send call notification using native APNs for iOS
 * This provides better reliability and lower latency than FCM
 */
async function sendAPNsCallNotification(
  token: string,
  callPayload: CallPushPayload
): Promise<boolean> {
  if (!apnProvider) {
    console.log('📱 [APNs] Provider not initialized');
    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // iOS uses VoIP push for incoming calls (handled by PKPushRegistry)
  // VoIP push triggers CallKit which shows the native phone call UI
  // 
  // We should NOT send a regular APNs alert for calls because:
  // 1. VoIP push already wakes the device and shows CallKit UI
  // 2. Regular APNs alert would show DUPLICATE notification banner
  //
  // Instead, we send a silent/background notification as a fallback
  // in case VoIP push fails or isn't registered.
  // ═══════════════════════════════════════════════════════════════
  
  console.log('📱 [APNs] Skipping call alert notification for iOS (VoIP handles this)');
  console.log('📱 [APNs] Sending silent background notification as fallback...');
  
  const notification = new apn.Notification({
    // NO alert - this prevents duplicate notification banner
    // alert: { ... },  // REMOVED to prevent duplicate notification
    contentAvailable: true,  // This wakes the app in background
    priority: 10, // Immediate delivery
    topic: process.env.APNS_BUNDLE_ID!,
    expiry: Math.floor(Date.now() / 1000) + 30, // Expire in 30 seconds
    payload: {
      type: 'incoming_call',
      callId: callPayload.callId,
      callerId: callPayload.callerId,
      callerName: callPayload.callerName || '',
      callType: callPayload.callType,
      timestamp: Date.now(),
    },
  });

  try {
    const result = await apnProvider.send(notification, token);
    
    if (result.failed.length > 0) {
      const failure = result.failed[0];
      console.error(`📱 [APNs] Failed to send:`, failure.response);
      
      // Check if token is invalid
      if (failure.response?.reason === 'BadDeviceToken' || 
          failure.response?.reason === 'Unregistered') {
        console.log(`📱 [APNs] Invalid token, should be removed: ${token.substring(0, 20)}...`);
      }
      
      return false;
    }
    
    console.log(`📱 [APNs] Silent call notification sent successfully`);
    return true;
  } catch (error) {
    console.error('📱 [APNs] Error sending notification:', error);
    return false;
  }
}

/**
 * Send message notification using native APNs for iOS
 */
async function sendAPNsMessageNotification(
  token: string,
  senderName: string,
  messagePreview: string,
  conversationId: string
): Promise<boolean> {
  if (!apnProvider) {
    console.log('📱 [APNs] Provider not initialized');
    return false;
  }

  const notification = new apn.Notification({
    alert: {
      title: `Message from ${senderName}`,
      body: messagePreview.substring(0, 100),
    },
    sound: 'default',
    badge: 1,
    category: 'MESSAGE',
    contentAvailable: true,
    topic: process.env.APNS_BUNDLE_ID!,
    priority: 10,
    payload: {
      type: 'message',
      conversationId,
      senderName,
    },
  });

  try {
    const result = await apnProvider.send(notification, token);
    
    if (result.failed.length > 0) {
      console.error(`📱 [APNs] Failed to send message notification:`, result.failed[0].response);
      return false;
    }
    
    console.log(`📱 [APNs] Message notification sent successfully`);
    return true;
  } catch (error) {
    console.error('📱 [APNs] Error sending message notification:', error);
    return false;
  }
}

/**
 * Cancel call notification using APNs (sends silent background notification)
 */
async function sendAPNsCallCancellation(
  token: string,
  callId: string
): Promise<void> {
  if (!apnProvider) return;

  const notification = new apn.Notification({
    contentAvailable: true,
    topic: process.env.APNS_BUNDLE_ID!,
    priority: 10,
    pushType: 'background',
    payload: {
      type: 'call_cancelled',
      callId,
      timestamp: Date.now(),
    },
  });

  try {
    await apnProvider.send(notification, token);
    console.log(`📱 [APNs] Call cancellation sent for ${callId}`);
  } catch (error) {
    // Ignore errors for cancellation
  }
}

// ═══════════════════════════════════════════════════════════════
// FIREBASE CLOUD MESSAGING (FCM) FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Send push notification via Firebase Cloud Messaging
 * Works for both Android and iOS (as fallback)
 */
export async function sendFCMPush(
  token: string,
  payload: PushPayload,
  platform: 'ios' | 'android'
): Promise<boolean> {
  if (!firebaseInitialized) {
    console.log('📱 [FCM] Firebase not initialized, skipping push');
    return false;
  }

  try {
    const message: admin.messaging.Message = {
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data || {},
    };

    // Platform-specific configuration
    if (platform === 'android') {
      message.android = {
        priority: 'high',
        notification: {
          channelId: 'messages',
          priority: 'high',
          sound: 'default',
        },
        ttl: 30000,
      };
    } else if (platform === 'ios') {
      message.apns = {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        payload: {
          aps: {
            alert: {
              title: payload.title,
              body: payload.body,
            },
            badge: payload.badge || 1,
            sound: payload.sound || 'default',
            'content-available': 1,
            'mutable-content': 1,
            category: payload.data?.type === 'incoming_call' ? 'INCOMING_CALL' : 'MESSAGE',
          },
        },
      };
    }

    const response = await admin.messaging().send(message);
    console.log(`📱 [FCM] Push sent successfully to ${platform}: ${response}`);
    return true;
  } catch (error: any) {
    console.error(`📱 [FCM] Failed to send push to ${platform}:`, error.message);

    if (error.code === 'messaging/registration-token-not-registered' ||
      error.code === 'messaging/invalid-registration-token') {
      console.log(`📱 [FCM] Token is invalid, should be removed: ${token.substring(0, 20)}...`);
      return false;
    }

    return false;
  }
}

/**
 * Send call notification via FCM
 * For Android: HIGH PRIORITY with notification payload to wake device
 * For iOS: Used as fallback if APNs fails
 */
async function sendFCMCallNotification(
  token: string,
  platform: 'ios' | 'android',
  callPayload: CallPushPayload
): Promise<boolean> {
  if (!firebaseInitialized) {
    console.log('📱 [FCM] Firebase not initialized, cannot send call notification');
    return false;
  }

  const callerDisplay = callPayload.callerName || 
    (callPayload.callerId?.substring(0, 10) + '...');
  
  const message: admin.messaging.Message = {
    token,
    // DATA payload - this is what the app receives
    data: {
      type: 'incoming_call',
      callId: callPayload.callId,
      callerId: callPayload.callerId,
      callerName: callPayload.callerName || '',
      caller: callPayload.callerName || callerDisplay, // For backward compatibility
      callType: callPayload.callType,
      timestamp: Date.now().toString(),
    },
  };

  if (platform === 'android') {
    // ════════════════════════════════════════════════════════════════
    // Android Call Notification Strategy:
    // 
    // We use DATA-ONLY payload (no notification) because:
    // - data payload with high priority: Wakes device from Doze/deep sleep
    // - The app's CallFirebaseMessagingService handles everything
    //
    // Previously we sent BOTH notification + data payloads, but this caused
    // DUPLICATE notifications:
    // 1. FCM system notification (from notification payload)
    // 2. App's IncomingCallService notification (with Answer/Decline buttons)
    //
    // With data-only:
    // 1. FCM delivers high-priority data message
    // 2. CallFirebaseMessagingService.onMessageReceived() is called
    // 3. IncomingCallService shows ONE notification with full controls
    // ════════════════════════════════════════════════════════════════
    message.android = {
      priority: 'high',
      ttl: 30000, // 30 seconds
      // NO notification payload - this prevents duplicate notifications
      // The app will create its own notification via IncomingCallService
    };
  }

  if (platform === 'ios') {
    // ════════════════════════════════════════════════════════════════
    // iOS Call Notification Strategy:
    // 
    // VoIP push (via PKPushRegistry) handles incoming calls on iOS.
    // VoIP push triggers CallKit which shows the native phone call UI.
    // 
    // We should NOT send an FCM alert for calls because:
    // 1. VoIP push already wakes the device and shows CallKit UI
    // 2. FCM alert would show DUPLICATE notification banner
    //
    // Instead, we send a background/silent notification as a fallback.
    // ════════════════════════════════════════════════════════════════
    console.log('📱 [FCM iOS] Sending silent call notification (VoIP handles UI)');
    
    message.apns = {
      headers: {
        'apns-priority': '10', // Immediate delivery
        'apns-push-type': 'background', // Background push, no alert
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 30), // Expire in 30s
      },
      payload: {
        aps: {
          // NO alert - this prevents duplicate notification banner
          'content-available': 1,
        },
        // Custom data for the app
        callData: {
          callId: callPayload.callId,
          callerId: callPayload.callerId,
          callerName: callPayload.callerName || '',
          callType: callPayload.callType,
        },
      },
    };
  }

  try {
    const response = await admin.messaging().send(message);
    console.log(`📞 [FCM] Call notification sent successfully: ${response}`);
    return true;
  } catch (error: any) {
    console.error(`📞 [FCM] Failed to send call notification:`, error.message);
    
    if (error.code === 'messaging/registration-token-not-registered' ||
      error.code === 'messaging/invalid-registration-token') {
      console.log(`📱 [FCM] Invalid token, should be removed`);
    }
    
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API - MAIN NOTIFICATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Send call notification - MAIN ENTRY POINT
 * iOS: Tries native APNs first, falls back to FCM
 * Android: Uses FCM with high-priority notification
 */
export async function sendCallNotification(
  token: string,
  platform: 'ios' | 'android',
  callPayload: CallPushPayload
): Promise<boolean> {
  console.log(`📞 Sending ${callPayload.callType} call notification to ${platform}`);
  console.log(`   Caller: ${callPayload.callerName || callPayload.callerId}`);
  console.log(`   CallId: ${callPayload.callId}`);

  // ═══════════════════════════════════════════════════════════════
  // iOS: Try native APNs first (better reliability)
  // ═══════════════════════════════════════════════════════════════
  if (platform === 'ios' && apnProvider) {
    const success = await sendAPNsCallNotification(token, callPayload);
    if (success) {
      return true;
    }
    
    console.log('📱 [APNs] Failed, falling back to FCM...');
  }

  // ═══════════════════════════════════════════════════════════════
  // Android or iOS fallback: Use FCM
  // ═══════════════════════════════════════════════════════════════
  return sendFCMCallNotification(token, platform, callPayload);
}

/**
 * Send message notification
 * iOS: Tries native APNs first, falls back to FCM
 * Android: Uses FCM
 */
export async function sendMessageNotification(
  token: string,
  platform: 'ios' | 'android',
  senderName: string,
  messagePreview: string,
  conversationId: string
): Promise<boolean> {
  // Try APNs first for iOS
  if (platform === 'ios' && apnProvider) {
    const success = await sendAPNsMessageNotification(
      token,
      senderName,
      messagePreview,
      conversationId
    );
    if (success) return true;
    
    console.log('📱 [APNs] Failed, falling back to FCM for message...');
  }

  // Use FCM
  return sendFCMPush(token, {
    title: `Message from ${senderName}`,
    body: messagePreview.substring(0, 100),
    data: {
      type: 'message',
      conversationId,
      senderName,
    },
    sound: 'default',
  }, platform);
}

/**
 * Cancel a call notification (when call is answered, rejected, or times out)
 */
export async function cancelCallNotification(
  tokens: Array<{ push_token: string; platform: 'ios' | 'android' }>,
  callId: string
): Promise<void> {
  console.log(`📞 Cancelling call notification for ${callId}`);

  for (const { push_token, platform } of tokens) {
    try {
      // Try APNs first for iOS
      if (platform === 'ios' && apnProvider) {
        await sendAPNsCallCancellation(push_token, callId);
        continue;
      }

      // Use FCM for Android or iOS fallback
      if (!firebaseInitialized) continue;

      const message: admin.messaging.Message = {
        token: push_token,
        data: {
          type: 'call_cancelled',
          callId,
          timestamp: Date.now().toString(),
        },
      };

      if (platform === 'android') {
        message.android = {
          priority: 'high',
          ttl: 0,
        };
      }

      if (platform === 'ios') {
        message.apns = {
          headers: {
            'apns-priority': '10',
            'apns-push-type': 'background',
          },
          payload: {
            aps: {
              'content-available': 1,
            },
          },
        };
      }

      await admin.messaging().send(message);
      console.log(`📞 [FCM] Call cancellation sent for ${callId}`);
    } catch (error) {
      // Ignore errors for cancellation
    }
  }
}

/**
 * Send call notification with deep link URL and auth token
 * Used for mobile devices to open /call page directly from notification
 */
export async function sendCallNotificationWithDeepLink(
  token: string,
  platform: 'ios' | 'android',
  callPayload: CallPushPayload,
  authToken: string,
  callUrl: string
): Promise<boolean> {
  console.log(`📞 Sending ${callPayload.callType} call notification with deep link to ${platform}`);
  console.log(`   Caller: ${callPayload.callerName || callPayload.callerId}`);
  console.log(`   CallId: ${callPayload.callId}`);
  console.log(`   Deep Link: ${callUrl.substring(0, 60)}...`);

  if (!firebaseInitialized) {
    console.log('📱 [FCM] Firebase not initialized, cannot send call notification');
    return false;
  }

  const callerDisplay = callPayload.callerName || 
    (callPayload.callerId?.substring(0, 10) + '...');

  const message: admin.messaging.Message = {
    token,
    // DATA payload - this is what the app receives
    data: {
      type: 'incoming_call',
      callId: callPayload.callId,
      callerId: callPayload.callerId,
      callerName: callPayload.callerName || '',
      caller: callPayload.callerName || callerDisplay,
      callType: callPayload.callType,
      timestamp: Date.now().toString(),
      // Include auth token and URL for deep linking
      authToken: authToken,
      callUrl: callUrl,
    },
  };

  if (platform === 'android') {
    // Android: Use high-priority data message with notification
    message.android = {
      priority: 'high',
      ttl: 30000, // 30 seconds
      notification: {
        channelId: 'calls',
        priority: 'max',
        title: `📞 Incoming ${callPayload.callType} call`,
        body: `${callerDisplay} is calling...`,
        sound: 'default',
        tag: `incoming-call-${callPayload.callId}`,
        visibility: 'public',
        clickAction: 'INCOMING_CALL',
      },
    };
  }

  if (platform === 'ios') {
    // iOS: Use alert notification with deep link data
    message.apns = {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 30),
      },
      payload: {
        aps: {
          alert: {
            title: `📞 Incoming ${callPayload.callType} call`,
            body: `${callerDisplay} is calling...`,
          },
          sound: 'default',
          badge: 1,
          'content-available': 1,
          'mutable-content': 1,
          category: 'INCOMING_CALL',
        },
        // Custom data for the app
        callId: callPayload.callId,
        callerId: callPayload.callerId,
        callerName: callPayload.callerName || '',
        callType: callPayload.callType,
        authToken: authToken,
        callUrl: callUrl,
      },
    };
  }

  try {
    const response = await admin.messaging().send(message);
    console.log(`📞 [FCM] Call notification with deep link sent successfully: ${response}`);
    return true;
  } catch (error: any) {
    console.error(`📞 [FCM] Failed to send call notification with deep link:`, error.message);
    
    if (error.code === 'messaging/registration-token-not-registered' ||
      error.code === 'messaging/invalid-registration-token') {
      console.log(`📱 [FCM] Invalid token, should be removed`);
    }
    
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  initializePushServices,
  initializeFirebase,
  initializeAPNs,
  sendFCMPush,
  sendCallNotification,
  sendCallNotificationWithDeepLink,
  sendMessageNotification,
  cancelCallNotification,
  firebaseInitialized
};