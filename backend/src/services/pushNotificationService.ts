// backend/src/services/pushNotificationService.ts
// Push notification service for iOS and Android using Firebase Cloud Messaging
// FIXED: Now properly wakes Android devices for incoming calls

import admin from 'firebase-admin';

// Initialize Firebase Admin SDK
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

/**
 * Send push notification via Firebase Cloud Messaging
 * Works for both Android and iOS
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
 * Send call notification - HIGH PRIORITY with notification payload
 * THIS IS THE KEY FIX: Android needs a notification payload to wake the device
 */
export async function sendCallNotification(
  token: string,
  platform: 'ios' | 'android',
  callPayload: CallPushPayload
): Promise<boolean> {
  if (!firebaseInitialized) {
    console.log('📱 [FCM] Firebase not initialized, cannot send call notification');
    return false;
  }

  console.log(`📞 [FCM] Sending ${callPayload.callType} call notification to ${platform}`);
  console.log(`   Caller: ${callPayload.callerName || callPayload.callerId}`);
  console.log(`   CallId: ${callPayload.callId}`);

  try {
    const callerDisplay = callPayload.callerName || (callPayload.callerId?.substring(0, 10) + '...');
    
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
      // CRITICAL FIX: Include notification payload to WAKE the device
      // Without this, data-only messages won't wake a sleeping device!
      // ════════════════════════════════════════════════════════════════
      message.android = {
        priority: 'high',
        ttl: 30000, // 30 seconds
        notification: {
          channelId: 'calls', // Must match Android notification channel
          title: `Incoming ${callPayload.callType} call`,
          body: `${callerDisplay} is calling...`,
          priority: 'max',
          visibility: 'public',
          sound: 'default',
          // These help wake the device
          defaultVibrateTimings: false,
          vibrateTimingsMillis: [0, 500, 200, 500, 200, 500],
          defaultLightSettings: false,
          lightSettings: {
            color: '#0000FF',
            lightOnDurationMillis: 500,
            lightOffDurationMillis: 500,
          },
          // Tag allows replacing/canceling this notification
          tag: `call-${callPayload.callId}`,
        },
      };
    }

    if (platform === 'ios') {
      message.apns = {
        headers: {
          'apns-priority': '10', // Immediate delivery
          'apns-push-type': 'alert',
          'apns-expiration': String(Math.floor(Date.now() / 1000) + 30), // Expire in 30s
        },
        payload: {
          aps: {
            alert: {
              title: `Incoming ${callPayload.callType} call`,
              body: `${callerDisplay} is calling...`,
            },
            sound: 'default', // Use 'ringtone.caf' if you have custom sound
            badge: 1,
            'content-available': 1,
            'mutable-content': 1,
            category: 'INCOMING_CALL',
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

/**
 * Send message notification
 */
export async function sendMessageNotification(
  token: string,
  platform: 'ios' | 'android',
  senderName: string,
  messagePreview: string,
  conversationId: string
): Promise<boolean> {
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
  if (!firebaseInitialized) return;

  console.log(`📞 [FCM] Cancelling call notification for ${callId}`);

  for (const { push_token, platform } of tokens) {
    try {
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

export default {
  initializeFirebase,
  sendFCMPush,
  sendCallNotification,
  sendMessageNotification,
  cancelCallNotification,
};
