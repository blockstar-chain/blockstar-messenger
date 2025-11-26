import { PushNotification } from '@/types';

/**
 * Push Notification Service
 * Handles browser push notifications and service worker registration
 */

export class PushNotificationService {
  private registration: ServiceWorkerRegistration | null = null;
  private permission: NotificationPermission = 'default';
  private vapidPublicKey: string = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

  /**
   * Initialize push notifications
   */
  async initialize(): Promise<void> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push notifications not supported');
      return;
    }

    try {
      // Register service worker
      this.registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registered');

      // Check current permission
      this.permission = Notification.permission;

      // If granted, subscribe
      if (this.permission === 'granted') {
        await this.subscribe();
      }
    } catch (error) {
      console.error('Failed to initialize push notifications:', error);
    }
  }

  /**
   * Request notification permission
   */
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('Notifications not supported');
      return false;
    }

    try {
      this.permission = await Notification.requestPermission();
      
      if (this.permission === 'granted') {
        await this.subscribe();
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }

  /**
   * Subscribe to push notifications
   */
  private async subscribe(): Promise<void> {
    if (!this.registration) {
      throw new Error('Service worker not registered');
    }

    try {
      const vapidKey = this.urlBase64ToUint8Array(this.vapidPublicKey);
      const subscription = await this.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: new Uint8Array(vapidKey.buffer.slice(0)),
      });

      // Send subscription to backend
      await this.sendSubscriptionToBackend(subscription);

      console.log('Push subscription successful');
    } catch (error) {
      console.error('Failed to subscribe to push:', error);
    }
  }

  /**
   * Send subscription to backend
   */
  private async sendSubscriptionToBackend(
    subscription: PushSubscription
  ): Promise<void> {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/push/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(subscription),
      });
    } catch (error) {
      console.error('Failed to send subscription to backend:', error);
    }
  }

  /**
   * Show local notification
   */
  async showNotification(notification: PushNotification): Promise<void> {
    if (this.permission !== 'granted' || !this.registration) {
      return;
    }

    try {
      await this.registration.showNotification(notification.title, {
        body: notification.body,
        icon: notification.icon || '/icon-192.png',
        badge: '/badge-72.png',
        tag: notification.tag || 'default',
        data: notification.data,
        vibrate: [200, 100, 200],
        actions: [
          { action: 'open', title: 'Open' },
          { action: 'close', title: 'Close' },
        ],
      });
    } catch (error) {
      console.error('Failed to show notification:', error);
    }
  }

  /**
   * Show notification for new message
   */
  async notifyNewMessage(
    senderName: string,
    message: string,
    conversationId: string
  ): Promise<void> {
    // Don't show if window is focused
    if (document.hasFocus()) {
      return;
    }

    await this.showNotification({
      title: `New message from ${senderName}`,
      body: message.substring(0, 100),
      icon: '/icon-192.png',
      tag: conversationId,
      data: { conversationId, type: 'message' },
    });
  }

  /**
   * Show notification for incoming call
   */
  async notifyIncomingCall(
    callerName: string,
    callType: 'audio' | 'video'
  ): Promise<void> {
    await this.showNotification({
      title: `Incoming ${callType} call`,
      body: `${callerName} is calling...`,
      icon: '/icon-192.png',
      tag: 'incoming-call',
      data: { type: 'call', callType },
    });

    // Play sound
    this.playNotificationSound();
  }

  /**
   * Show notification for group mention
   */
  async notifyGroupMention(
    groupName: string,
    senderName: string,
    message: string
  ): Promise<void> {
    await this.showNotification({
      title: `${senderName} mentioned you in ${groupName}`,
      body: message.substring(0, 100),
      icon: '/icon-192.png',
      tag: 'group-mention',
      data: { type: 'mention' },
    });
  }

  /**
   * Unsubscribe from push notifications
   */
  async unsubscribe(): Promise<void> {
    if (!this.registration) {
      return;
    }

    try {
      const subscription = await this.registration.pushManager.getSubscription();
      
      if (subscription) {
        await subscription.unsubscribe();
        console.log('Unsubscribed from push notifications');
      }
    } catch (error) {
      console.error('Failed to unsubscribe:', error);
    }
  }

  /**
   * Check if notifications are enabled
   */
  isEnabled(): boolean {
    return this.permission === 'granted';
  }

  /**
   * Get push subscription
   */
  async getSubscription(): Promise<PushSubscription | null> {
    if (!this.registration) {
      return null;
    }

    return await this.registration.pushManager.getSubscription();
  }

  /**
   * Play notification sound
   */
  private playNotificationSound(): void {
    const audio = new Audio('/sounds/notification.mp3');
    audio.volume = 0.5;
    audio.play().catch((error) => {
      console.error('Failed to play notification sound:', error);
    });
  }

  /**
   * Convert VAPID key to Uint8Array
   */
  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  }
}

export const pushNotificationService = new PushNotificationService();
