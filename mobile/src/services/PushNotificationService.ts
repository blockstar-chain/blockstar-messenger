import messaging from '@react-native-firebase/messaging';
import { Platform } from 'react-native';

class PushNotificationService {
  private token: string | null = null;

  async initialize(): Promise<void> {
    try {
      // Request permission
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (enabled) {
        console.log('📱 Push notification permission granted');
        
        // Get FCM token
        this.token = await messaging().getToken();
        console.log('📱 FCM Token:', this.token);

        // Listen for token refresh
        messaging().onTokenRefresh(token => {
          this.token = token;
          console.log('📱 FCM Token refreshed:', token);
          // TODO: Send new token to your backend
        });

        // Handle foreground messages
        messaging().onMessage(async remoteMessage => {
          console.log('📱 Foreground message:', remoteMessage);
          // TODO: Show local notification or update UI
        });

        // Handle background messages
        messaging().setBackgroundMessageHandler(async remoteMessage => {
          console.log('📱 Background message:', remoteMessage);
        });
      } else {
        console.log('📱 Push notification permission denied');
      }
    } catch (error) {
      console.error('📱 Push notification initialization error:', error);
    }
  }

  async getToken(): Promise<string | null> {
    if (!this.token) {
      try {
        this.token = await messaging().getToken();
      } catch (error) {
        console.error('Error getting FCM token:', error);
      }
    }
    return this.token;
  }

  async requestPermission(): Promise<boolean> {
    try {
      const authStatus = await messaging().requestPermission();
      return (
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL
      );
    } catch (error) {
      console.error('Error requesting permission:', error);
      return false;
    }
  }

  async subscribeToTopic(topic: string): Promise<void> {
    try {
      await messaging().subscribeToTopic(topic);
      console.log(`📱 Subscribed to topic: ${topic}`);
    } catch (error) {
      console.error('Error subscribing to topic:', error);
    }
  }

  async unsubscribeFromTopic(topic: string): Promise<void> {
    try {
      await messaging().unsubscribeFromTopic(topic);
      console.log(`📱 Unsubscribed from topic: ${topic}`);
    } catch (error) {
      console.error('Error unsubscribing from topic:', error);
    }
  }
}

export const pushNotificationService = new PushNotificationService();
