// frontend/src/lib/native/IncomingCallService.ts
// TypeScript wrapper for the IncomingCall Capacitor plugin
// Used to retrieve call data when app is opened from a notification

import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

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

// Register the plugin (only available on native platforms)
const IncomingCallPlugin = registerPlugin<IncomingCallPluginInterface>('IncomingCall');

// ============================================
// SERVICE CLASS
// ============================================

class IncomingCallNativeService {
  private static instance: IncomingCallNativeService;
  private listeners: Set<(data: PendingCallData) => void> = new Set();
  private checkInterval: NodeJS.Timeout | null = null;
  private lastCheckedCallId: string | null = null;

  private constructor() {}

  static getInstance(): IncomingCallNativeService {
    if (!IncomingCallNativeService.instance) {
      IncomingCallNativeService.instance = new IncomingCallNativeService();
    }
    return IncomingCallNativeService.instance;
  }

  /**
   * Check if running on native platform
   */
  isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Check if there's a pending incoming call
   */
  async hasPendingCall(): Promise<boolean> {
    if (!this.isNative()) {
      return false;
    }

    try {
      const result = await IncomingCallPlugin.hasPendingCall();
      return result.hasPendingCall;
    } catch (error) {
      console.error('Error checking pending call:', error);
      return false;
    }
  }

  /**
   * Get the pending call data
   * Returns null if no pending call
   */
  async getPendingCall(): Promise<PendingCallData | null> {
    if (!this.isNative()) {
      return null;
    }

    try {
      const data = await IncomingCallPlugin.getPendingCall();
      if (data.callId) {
        console.log('📞 Got pending call from native:', data);
        return data;
      }
      return null;
    } catch (error) {
      console.error('Error getting pending call:', error);
      return null;
    }
  }

  /**
   * Clear the pending call after it's been handled
   */
  async clearPendingCall(): Promise<void> {
    if (!this.isNative()) {
      return;
    }

    try {
      await IncomingCallPlugin.clearPendingCall();
      this.lastCheckedCallId = null;
    } catch (error) {
      console.error('Error clearing pending call:', error);
    }
  }

  /**
   * Notify native layer that call was answered
   */
  async notifyCallAnswered(callId: string): Promise<void> {
    if (!this.isNative()) {
      return;
    }

    try {
      await IncomingCallPlugin.notifyCallAnswered({ callId });
      this.lastCheckedCallId = null;
    } catch (error) {
      console.error('Error notifying call answered:', error);
    }
  }

  /**
   * Notify native layer that call was declined
   */
  async notifyCallDeclined(callId: string): Promise<void> {
    if (!this.isNative()) {
      return;
    }

    try {
      await IncomingCallPlugin.notifyCallDeclined({ callId });
      this.lastCheckedCallId = null;
    } catch (error) {
      console.error('Error notifying call declined:', error);
    }
  }

  /**
   * Register a listener for incoming calls
   */
  onIncomingCall(callback: (data: PendingCallData) => void): () => void {
    this.listeners.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Start checking for pending calls periodically
   * Call this when app becomes active
   */
  startChecking(): void {
    if (!this.isNative()) {
      return;
    }

    // Check immediately
    this.checkForPendingCall();

    // Check every 500ms in case we missed it
    if (!this.checkInterval) {
      this.checkInterval = setInterval(() => {
        this.checkForPendingCall();
      }, 500);

      // Stop after 5 seconds (10 checks)
      setTimeout(() => {
        this.stopChecking();
      }, 5000);
    }
  }

  /**
   * Stop checking for pending calls
   */
  stopChecking(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check for pending call and notify listeners
   */
  private async checkForPendingCall(): Promise<void> {
    const callData = await this.getPendingCall();
    
    if (callData && callData.callId && callData.callId !== this.lastCheckedCallId) {
      this.lastCheckedCallId = callData.callId;
      console.log('📞 New incoming call detected:', callData);
      
      // Notify all listeners
      this.listeners.forEach(listener => {
        try {
          listener(callData);
        } catch (error) {
          console.error('Error in incoming call listener:', error);
        }
      });
    }
  }

  /**
   * Check for pending call once (call on app start/resume)
   */
  async checkOnce(): Promise<PendingCallData | null> {
    const callData = await this.getPendingCall();
    
    if (callData && callData.callId) {
      // Notify listeners
      this.listeners.forEach(listener => {
        try {
          listener(callData);
        } catch (error) {
          console.error('Error in incoming call listener:', error);
        }
      });
    }

    return callData;
  }
}

// Export singleton instance
export const incomingCallService = IncomingCallNativeService.getInstance();

// ============================================
// USAGE EXAMPLE (add to your app's main component or hook)
// ============================================
/*

// In your main App component or a custom hook:

import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { incomingCallService, PendingCallData } from '@/lib/native/IncomingCallService';

// In your component:
useEffect(() => {
  // Check for pending call on mount
  const checkPendingCall = async () => {
    const callData = await incomingCallService.checkOnce();
    if (callData) {
      console.log('📞 App opened with incoming call:', callData);
      // Show your incoming call UI
      showIncomingCallModal(callData);
    }
  };

  checkPendingCall();

  // Listen for future incoming calls
  const unsubscribe = incomingCallService.onIncomingCall((data: PendingCallData) => {
    console.log('📞 Incoming call:', data);
    showIncomingCallModal(data);
  });

  // Check when app resumes from background
  const appStateListener = CapacitorApp.addListener('appStateChange', async ({ isActive }) => {
    if (isActive) {
      console.log('📱 App became active, checking for pending call');
      const callData = await incomingCallService.checkOnce();
      if (callData) {
        showIncomingCallModal(callData);
      }
    }
  });

  return () => {
    unsubscribe();
    appStateListener.remove();
    incomingCallService.stopChecking();
  };
}, []);

// When user answers the call:
const handleAnswerCall = async (callId: string) => {
  await incomingCallService.notifyCallAnswered(callId);
  // ... handle answer logic
};

// When user declines the call:
const handleDeclineCall = async (callId: string) => {
  await incomingCallService.notifyCallDeclined(callId);
  // ... handle decline logic
};

*/
