// frontend/src/lib/notificationService.ts
// Comprehensive notification service for calls, messages, and badges

import { Capacitor } from '@capacitor/core';
import { Badge } from '@capawesome/capacitor-badge';
import { LocalNotifications } from '@capacitor/local-notifications';

// ============================================
// TYPES
// ============================================

interface NotificationOptions {
  title: string;
  body: string;
  tag?: string;
  icon?: string;
  badge?: string;
  sound?: string;
  vibrate?: number[];
  requireInteraction?: boolean;
  actions?: NotificationAction[];
  data?: any;
}

interface NotificationAction {
  action: string;
  title: string;
  icon?: string;
}

// ============================================
// BADGE MANAGEMENT
// ============================================

let unreadMessageCount = 0;
let missedCallCount = 0;

/**
 * Update the app badge with total unread count
 */
export async function updateAppBadge(): Promise<void> {
  const totalCount = unreadMessageCount + missedCallCount;
  
  try {
    if (Capacitor.isNativePlatform()) {
      // Native app badge (Android/iOS)
      if (totalCount > 0) {
        await Badge.set({ count: totalCount });
        console.log('📛 Badge set to:', totalCount);
      } else {
        await Badge.clear();
        console.log('📛 Badge cleared');
      }
    } else {
      // Web/PWA badge using Navigator Badge API
      if ('setAppBadge' in navigator) {
        if (totalCount > 0) {
          await (navigator as any).setAppBadge(totalCount);
          console.log('📛 Web badge set to:', totalCount);
        } else {
          await (navigator as any).clearAppBadge();
          console.log('📛 Web badge cleared');
        }
      }
    }
  } catch (error) {
    console.warn('Could not update badge:', error);
  }
}

/**
 * Set unread message count
 */
export async function setUnreadMessageCount(count: number): Promise<void> {
  unreadMessageCount = count;
  await updateAppBadge();
}

/**
 * Increment unread message count
 */
export async function incrementUnreadMessages(): Promise<void> {
  unreadMessageCount++;
  await updateAppBadge();
}

/**
 * Add missed call to count
 */
export async function addMissedCall(): Promise<void> {
  missedCallCount++;
  await updateAppBadge();
}

/**
 * Clear missed calls
 */
export async function clearMissedCalls(): Promise<void> {
  missedCallCount = 0;
  await updateAppBadge();
}

/**
 * Clear all badges
 */
export async function clearAllBadges(): Promise<void> {
  unreadMessageCount = 0;
  missedCallCount = 0;
  await updateAppBadge();
}

// ============================================
// BROWSER NOTIFICATIONS
// ============================================

let notificationPermission: NotificationPermission = 'default';

/**
 * Request notification permission
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.warn('Notifications not supported');
    return false;
  }

  if (Notification.permission === 'granted') {
    notificationPermission = 'granted';
    return true;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    notificationPermission = permission;
    return permission === 'granted';
  }

  return false;
}

/**
 * Show browser notification for incoming call
 */
export async function showIncomingCallNotification(
  callerName: string,
  callerId: string,
  callId: string,
  callType: 'audio' | 'video' = 'audio'
): Promise<Notification | null> {
  // Skip on native - handled by native notification
  if (Capacitor.isNativePlatform()) {
    return null;
  }

  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) {
    console.warn('Notification permission not granted');
    return null;
  }

  const notification = new Notification(`Incoming ${callType} call`, {
    body: `${callerName} is calling...`,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: `call-${callId}`,
    requireInteraction: true, // Keep notification until user interacts
    vibrate: [200, 100, 200, 100, 200],
    data: {
      type: 'incoming_call',
      callId,
      callerId,
      callerName,
      callType,
    },
  });

  // Handle notification click - focus the app
  notification.onclick = () => {
    window.focus();
    notification.close();
  };

  console.log('🔔 Browser notification shown for incoming call');
  return notification;
}

/**
 * Show browser notification for new message
 */
export async function showMessageNotification(
  senderName: string,
  messagePreview: string,
  conversationId: string
): Promise<Notification | null> {
  // Skip on native - handled by FCM
  if (Capacitor.isNativePlatform()) {
    return null;
  }

  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) {
    return null;
  }

  // Don't show if window is focused
  if (document.hasFocus()) {
    return null;
  }

  const notification = new Notification(senderName, {
    body: messagePreview.substring(0, 100),
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: `message-${conversationId}`,
    data: {
      type: 'message',
      conversationId,
    },
  });

  notification.onclick = () => {
    window.focus();
    // Could dispatch event to open conversation
    window.dispatchEvent(new CustomEvent('openConversation', { 
      detail: { conversationId } 
    }));
    notification.close();
  };

  return notification;
}

/**
 * Show browser notification for missed call
 */
export async function showMissedCallNotification(
  callerName: string,
  callerId: string,
  callType: 'audio' | 'video' = 'audio'
): Promise<Notification | null> {
  // Skip on native
  if (Capacitor.isNativePlatform()) {
    return null;
  }

  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) {
    return null;
  }

  const notification = new Notification('Missed Call', {
    body: `You missed a ${callType} call from ${callerName}`,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: `missed-call-${callerId}-${Date.now()}`,
    data: {
      type: 'missed_call',
      callerId,
      callerName,
      callType,
    },
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };

  // Update badge
  await addMissedCall();

  return notification;
}

/**
 * Close notification by tag
 */
export function closeNotification(tag: string): void {
  // Note: We can't programmatically close browser notifications
  // They need to be closed by user interaction or timeout
  console.log('Notification close requested for:', tag);
}

// ============================================
// NATIVE LOCAL NOTIFICATIONS (for Android when app is open)
// ============================================

/**
 * Initialize local notifications (call on app start)
 */
export async function initializeLocalNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const permission = await LocalNotifications.requestPermissions();
    console.log('Local notification permission:', permission);

    // Listen for notification actions
    LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
      console.log('Notification action:', notification);
      
      const data = notification.notification.extra;
      if (data?.type === 'incoming_call') {
        if (notification.actionId === 'answer') {
          window.dispatchEvent(new CustomEvent('answerCall', { detail: data }));
        } else if (notification.actionId === 'decline') {
          window.dispatchEvent(new CustomEvent('declineCall', { detail: data }));
        }
      }
    });

  } catch (error) {
    console.error('Failed to initialize local notifications:', error);
  }
}

/**
 * Show local notification for incoming call (Android when app is open)
 */
export async function showLocalCallNotification(
  callerName: string,
  callerId: string,
  callId: string,
  callType: 'audio' | 'video' = 'audio'
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Date.now(),
          title: `Incoming ${callType} call`,
          body: `${callerName} is calling...`,
          ongoing: true,
          autoCancel: false,
          channelId: 'calls',
          extra: {
            type: 'incoming_call',
            callId,
            callerId,
            callerName,
            callType,
          },
          actionTypeId: 'CALL_ACTIONS',
        },
      ],
    });
  } catch (error) {
    console.error('Failed to show local notification:', error);
  }
}

/**
 * Cancel call notification
 */
export async function cancelCallNotification(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const pending = await LocalNotifications.getPending();
    const callNotifications = pending.notifications.filter(
      n => n.extra?.type === 'incoming_call'
    );
    
    if (callNotifications.length > 0) {
      await LocalNotifications.cancel({
        notifications: callNotifications.map(n => ({ id: n.id })),
      });
    }
  } catch (error) {
    console.error('Failed to cancel call notification:', error);
  }
}

// ============================================
// UTILITY
// ============================================

/**
 * Check if notifications are supported and permitted
 */
export function areNotificationsEnabled(): boolean {
  if (Capacitor.isNativePlatform()) {
    return true; // Assume enabled on native
  }
  return 'Notification' in window && Notification.permission === 'granted';
}

/**
 * Play notification sound (web)
 */
export function playNotificationSound(type: 'message' | 'call' = 'message'): void {
  try {
    const soundFile = type === 'call' ? '/sounds/incoming.mp3' : '/sounds/message.mp3';
    const audio = new Audio(soundFile);
    audio.volume = 0.5;
    audio.play().catch(e => console.warn('Could not play sound:', e));
  } catch (e) {
    console.warn('Could not play notification sound:', e);
  }
}
