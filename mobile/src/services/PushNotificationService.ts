import messaging from '@react-native-firebase/messaging';

class PushNotificationService {
  async initialize(): Promise<void> {
    const authStatus = await messaging().requestPermission();
    if (authStatus === messaging.AuthorizationStatus.AUTHORIZED) {
      const token = await messaging().getToken();
      console.log('📱 FCM Token:', token);
    }
  }
}

export const pushNotificationService = new PushNotificationService();
