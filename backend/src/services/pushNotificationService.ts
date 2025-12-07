// backend/src/services/pushNotificationService.ts
// Push notification service for iOS and Android using Firebase Cloud Messaging

import admin from 'firebase-admin';

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

export function initializeFirebase(): boolean {
  if (firebaseInitialized) return true;

  // Check for required environment variables
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
          channelId: 'calls', // High priority channel for calls
          priority: 'max',
          sound: 'default',
          vibrateTimingsMillis: [200, 100, 200, 100, 200],
        },
        // Time to live - 30 seconds for calls
        ttl: 30000,
      };
    } else if (platform === 'ios') {
      message.apns = {
        headers: {
          'apns-priority': '10', // High priority
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
            // Category for actionable notifications
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

    // Handle specific error codes
    if (error.code === 'messaging/registration-token-not-registered' ||
      error.code === 'messaging/invalid-registration-token') {
      // Token is invalid, should be removed from database
      console.log(`📱 [FCM] Token is invalid, should be removed: ${token.substring(0, 20)}...`);
      return false;
    }

    return false;
  }
}

/**
 * Send call notification - high priority with custom payload
 */
export async function sendCallNotification(
  token: string,
  platform: 'ios' | 'android',
  callPayload: CallPushPayload
): Promise<boolean> {
  if (!firebaseInitialized) return false;

  const message: admin.messaging.Message = {
    token,
    data: {
      type: 'incoming_call',
      callId: callPayload.callId,
      callerId: callPayload.callerId,
      callerName: callPayload.callerName || '',
      callType: callPayload.callType,
      timestamp: Date.now().toString(),
    },
  };

  if (platform === 'android') {
    message.android = {
      priority: 'high',
      ttl: 30000,
      // ❗ NO notification: block here
    };
  }

  if (platform === 'ios') {
    // unchanged (iOS can use notification block)
    message.apns = {
      headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
      payload: {
        aps: {
          alert: {
            title: `Incoming ${callPayload.callType} call`,
            body: `${callPayload.callerName || ''} is calling...`,
          },
          sound: 'ringtone.caf',
          badge: 1,
          'content-available': 1,
        },
      },
    };
  }

  await admin.messaging().send(message);
  return true;
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
 * Cancel a call notification (when call is answered or rejected)
 */
export async function cancelCallNotification(
  tokens: Array<{ push_token: string; platform: 'ios' | 'android' }>,
  callId: string
): Promise<void> {
  if (!firebaseInitialized) return;

  // Send a data message to cancel the notification
  for (const { push_token, platform } of tokens) {
    try {
      const message: admin.messaging.Message = {
        token: push_token,
        data: {
          type: 'call_cancelled',
          callId,
        },
      };

      if (platform === 'android') {
        message.android = {
          priority: 'high',
          ttl: 0,
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
