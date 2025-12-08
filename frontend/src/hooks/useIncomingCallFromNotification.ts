// frontend/src/hooks/useIncomingCallFromNotification.ts
// React hook to handle incoming calls when app is opened from notification

import { useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

// ============================================
// TYPES
// ============================================

export interface PendingCallData {
  callId: string | null;
  caller: string;
  callerId: string;
  callType: 'audio' | 'video';
  fromNotification: boolean;
  timestamp: number;
}

interface IncomingCallPluginInterface {
  hasPendingCall(): Promise<{ hasPendingCall: boolean }>;
  getPendingCall(): Promise<PendingCallData>;
  clearPendingCall(): Promise<void>;
  notifyCallAnswered(options: { callId: string }): Promise<void>;
  notifyCallDeclined(options: { callId: string }): Promise<void>;
}

// Register the plugin (only on native)
const IncomingCallPlugin = Capacitor.isNativePlatform() 
  ? registerPlugin<IncomingCallPluginInterface>('IncomingCall')
  : null;

// ============================================
// HOOK OPTIONS
// ============================================

interface UseIncomingCallOptions {
  /**
   * Called when an incoming call is detected
   */
  onIncomingCall: (data: PendingCallData) => void;
  
  /**
   * Whether the hook is active (e.g., only when user is logged in)
   */
  enabled?: boolean;
}

// ============================================
// HOOK IMPLEMENTATION
// ============================================

/**
 * Hook to handle incoming calls from push notifications
 * 
 * When user taps an incoming call notification, the app opens and
 * this hook detects the pending call and triggers onIncomingCall
 * 
 * Usage:
 * ```tsx
 * const { notifyAnswered, notifyDeclined } = useIncomingCallFromNotification({
 *   onIncomingCall: (data) => {
 *     setIncomingCallData(data);
 *     setShowIncomingCallModal(true);
 *   },
 *   enabled: !!currentUser
 * });
 * ```
 */
export function useIncomingCallFromNotification({ 
  onIncomingCall, 
  enabled = true 
}: UseIncomingCallOptions) {
  const hasCheckedRef = useRef(false);
  const lastCallIdRef = useRef<string | null>(null);

  // Stable callback ref to avoid re-running effects
  const onIncomingCallRef = useRef(onIncomingCall);
  onIncomingCallRef.current = onIncomingCall;

  // Check for pending call
  const checkForPendingCall = useCallback(async () => {
    if (!Capacitor.isNativePlatform() || !enabled || !IncomingCallPlugin) {
      return;
    }

    try {
      const data = await IncomingCallPlugin.getPendingCall();
      
      if (data && data.callId && data.callId !== lastCallIdRef.current) {
        console.log('📞 Incoming call from notification:', data);
        lastCallIdRef.current = data.callId;
        onIncomingCallRef.current(data);
      }
    } catch (error) {
      console.error('Error checking for pending call:', error);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !Capacitor.isNativePlatform()) {
      return;
    }

    // Check immediately on mount (app launch)
    if (!hasCheckedRef.current) {
      hasCheckedRef.current = true;
      // Small delay to ensure app is fully loaded
      setTimeout(() => {
        checkForPendingCall();
      }, 300);
    }

    // Check when app resumes from background
    let appStateListener: any = null;
    
    const setupAppStateListener = async () => {
      try {
        const { App } = await import('@capacitor/app');
        appStateListener = await App.addListener('appStateChange', async ({ isActive }) => {
          if (isActive) {
            console.log('📱 App resumed, checking for pending call');
            // Small delay for intent to be processed
            setTimeout(() => {
              checkForPendingCall();
            }, 200);
          }
        });
      } catch (error) {
        console.warn('Could not set up app state listener:', error);
      }
    };

    setupAppStateListener();

    return () => {
      if (appStateListener) {
        appStateListener.remove();
      }
    };
  }, [enabled, checkForPendingCall]);

  // Return helper functions
  return {
    /**
     * Call when user answers the call
     */
    notifyAnswered: async (callId: string) => {
      if (IncomingCallPlugin) {
        try {
          await IncomingCallPlugin.notifyCallAnswered({ callId });
        } catch (error) {
          console.error('Error notifying call answered:', error);
        }
      }
      lastCallIdRef.current = null;
    },

    /**
     * Call when user declines the call
     */
    notifyDeclined: async (callId: string) => {
      if (IncomingCallPlugin) {
        try {
          await IncomingCallPlugin.notifyCallDeclined({ callId });
        } catch (error) {
          console.error('Error notifying call declined:', error);
        }
      }
      lastCallIdRef.current = null;
    },

    /**
     * Clear pending call state
     */
    clearPending: async () => {
      if (IncomingCallPlugin) {
        try {
          await IncomingCallPlugin.clearPendingCall();
        } catch (error) {
          console.error('Error clearing pending call:', error);
        }
      }
      lastCallIdRef.current = null;
    },

    /**
     * Manually trigger a check for pending calls
     */
    checkNow: checkForPendingCall
  };
}

export default useIncomingCallFromNotification;
