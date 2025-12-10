// frontend/src/hooks/usePushNotifications.ts
// Hook for integrating push notifications with the app lifecycle

import { useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import {
  initializePushNotifications,
  verifyPushRegistration,
  updatePushCallbacks,
  unregisterPushNotifications,
  checkTokenExists,
  retryPermissionRequest,
  getPermissionInfo,
  testPushNotification,
  PushNotificationCallbacks,
} from '@/lib/pushNotifications';

interface UsePushNotificationsOptions {
  walletAddress: string | null;
  onIncomingCall?: (data: any) => void;
  onMessage?: (data: any) => void;
  onMissedCall?: (data: any) => void;
  onNotificationTapped?: (data: any) => void;
  onTokenRegistered?: (token: string) => void;
  onPermissionDenied?: () => void;
}

export function usePushNotifications({
  walletAddress,
  onIncomingCall,
  onMessage,
  onMissedCall,
  onNotificationTapped,
  onTokenRegistered,
  onPermissionDenied,
}: UsePushNotificationsOptions) {
  const isInitializedRef = useRef(false);
  const walletRef = useRef<string | null>(null);

  // Initialize push notifications when wallet connects
  useEffect(() => {
    if (!walletAddress || !Capacitor.isNativePlatform()) {
      return;
    }

    // Prevent duplicate initialization for same wallet
    if (isInitializedRef.current && walletRef.current === walletAddress) {
      // Just update callbacks
      updatePushCallbacks({
        onIncomingCall,
        onMessage,
        onMissedCall,
        onNotificationTapped,
        onTokenRegistered,
        onPermissionDenied,
      });
      return;
    }

    console.log('📱 usePushNotifications: Initializing for', walletAddress);
    walletRef.current = walletAddress;

    const init = async () => {
      const success = await initializePushNotifications(walletAddress, {
        onIncomingCall,
        onMessage,
        onMissedCall,
        onNotificationTapped,
        onTokenRegistered,
        onPermissionDenied,
      });

      isInitializedRef.current = success;
      
      if (!success) {
        console.log('📱 Push initialization failed - will retry on app resume');
      }
    };

    init();

    // Cleanup on unmount or wallet change
    return () => {
      // Don't unregister on unmount - we want to keep receiving notifications
      // Only unregister on explicit logout
    };
  }, [walletAddress]);

  // Update callbacks when they change
  useEffect(() => {
    if (!isInitializedRef.current) return;

    updatePushCallbacks({
      onIncomingCall,
      onMessage,
      onMissedCall,
      onNotificationTapped,
      onTokenRegistered,
      onPermissionDenied,
    });
  }, [onIncomingCall, onMessage, onMissedCall, onNotificationTapped, onTokenRegistered, onPermissionDenied]);

  // Verify registration on app resume
  useEffect(() => {
    if (!walletAddress || !Capacitor.isNativePlatform()) {
      return;
    }

    const setupAppStateListener = async () => {
      const listener = await App.addListener('appStateChange', async ({ isActive }) => {
        if (isActive && walletAddress) {
          console.log('📱 App resumed - verifying push registration');
          
          // Check if token still exists in backend
          const tokenStatus = await checkTokenExists(walletAddress);
          
          if (!tokenStatus.hasToken) {
            console.log('📱 Token missing - re-initializing push notifications');
            await initializePushNotifications(walletAddress, {
              onIncomingCall,
              onMessage,
              onMissedCall,
              onNotificationTapped,
              onTokenRegistered,
              onPermissionDenied,
            });
          } else {
            console.log('📱 Token verified - push notifications active');
          }
        }
      });

      return () => {
        listener.remove();
      };
    };

    let cleanup: (() => void) | undefined;
    setupAppStateListener().then(cleanupFn => {
      cleanup = cleanupFn;
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, [walletAddress, onIncomingCall, onMessage, onMissedCall, onNotificationTapped, onTokenRegistered, onPermissionDenied]);

  // Expose utility functions
  const logout = useCallback(async () => {
    await unregisterPushNotifications();
    isInitializedRef.current = false;
    walletRef.current = null;
  }, []);

  const retryPermission = useCallback(async () => {
    return retryPermissionRequest();
  }, []);

  const getPermissionStatus = useCallback(() => {
    return getPermissionInfo();
  }, []);

  const sendTestNotification = useCallback(async () => {
    return testPushNotification();
  }, []);

  return {
    logout,
    retryPermission,
    getPermissionStatus,
    sendTestNotification,
  };
}

export default usePushNotifications;
