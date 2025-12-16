// frontend/src/hooks/useIncomingCallFromNotification.ts
// Handles incoming calls that arrive via push notification when app is closed

import { useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { useAppStore } from '@/store';
import { webSocketService } from '@/lib/websocket';

export interface PendingCallData {
  type: 'incoming_call';
  callId: string;
  callerId: string;
  callerName: string;
  caller?: string; // Alias for callerName
  callType: 'audio' | 'video';
  action?: 'answer' | 'decline' | null;
  fromNotification: boolean;
}

interface UseIncomingCallFromNotificationOptions {
  onIncomingCall?: (data: PendingCallData) => void;
  onAnswerCall?: (data: PendingCallData) => void;
  onDeclineCall?: (data: PendingCallData) => void;
  enabled?: boolean;
}

// Global flag to prevent multiple instances from setting up listeners
let globalListenersSetUp = false;

export function useIncomingCallFromNotification(options: UseIncomingCallFromNotificationOptions = {}) {
  const { onIncomingCall, onAnswerCall, onDeclineCall, enabled = true } = options;
  const { setIncomingCall, currentUser } = useAppStore();
  const processedCallIds = useRef<Set<string>>(new Set());
  const hasSetupRef = useRef(false);
  
  // Use refs for callbacks to avoid re-running the effect when callbacks change
  // This prevents the excessive re-render issue
  const onIncomingCallRef = useRef(onIncomingCall);
  const onAnswerCallRef = useRef(onAnswerCall);
  const onDeclineCallRef = useRef(onDeclineCall);
  const setIncomingCallRef = useRef(setIncomingCall);
  const currentUserRef = useRef(currentUser);
  
  // Keep refs updated without triggering effect re-runs
  useEffect(() => {
    onIncomingCallRef.current = onIncomingCall;
    onAnswerCallRef.current = onAnswerCall;
    onDeclineCallRef.current = onDeclineCall;
    setIncomingCallRef.current = setIncomingCall;
    currentUserRef.current = currentUser;
  });

  // Notify that a call was answered (to stop ringtone on other devices, etc.)
  const notifyAnswered = useCallback(async (callId: string) => {
    console.log('📞 Notifying server: call answered', callId);
    // The actual WebRTC answer happens in the component
    // This just signals the server
  }, []);

  // Notify that a call was declined
  const notifyDeclined = useCallback(async (callId: string) => {
    console.log('📞 Notifying server: call declined', callId);
    webSocketService.emit('call:decline', { callId });
  }, []);

  useEffect(() => {
    // Only setup if enabled and has wallet
    if (!enabled || !currentUser?.walletAddress) {
      return;
    }

    // Prevent duplicate setups - only log once per component instance
    if (hasSetupRef.current) {
      return;
    }
    
    // Check if global listeners are already set up by another instance
    if (globalListenersSetUp) {
      // Still mark this instance as set up to prevent future re-runs
      hasSetupRef.current = true;
      return;
    }

    hasSetupRef.current = true;
    globalListenersSetUp = true;
    
    console.log('📞 useIncomingCallFromNotification: Setting up listeners');

    // Handler for native events
    const handleNativeCallEvent = (event: CustomEvent<PendingCallData>) => {
      const data = event.detail;
      const user = currentUserRef.current;
      
      if (!user?.walletAddress) {
        console.log('📞 No current user, ignoring call event');
        return;
      }
      
      console.log('═══════════════════════════════════════');
      console.log('📞 INCOMING CALL FROM NOTIFICATION');
      console.log('  Call ID:', data.callId);
      console.log('  Caller:', data.callerName || data.caller);
      console.log('  Type:', data.callType);
      console.log('  Action:', data.action);
      console.log('═══════════════════════════════════════');

      // Prevent duplicate processing
      if (processedCallIds.current.has(data.callId)) {
        console.log('📞 Call already processed, skipping');
        return;
      }
      processedCallIds.current.add(data.callId);

      // Clean up old call IDs (keep last 10)
      if (processedCallIds.current.size > 10) {
        const ids = Array.from(processedCallIds.current);
        ids.slice(0, ids.length - 10).forEach(id => processedCallIds.current.delete(id));
      }

      // Normalize caller name
      const callerName = data.callerName || data.caller || 'Unknown';

      // Handle based on action
      if (data.action === 'answer') {
        console.log('📞 User tapped ANSWER from notification');
        
        // Set incoming call state so the modal shows
        setIncomingCallRef.current({
          id: data.callId,
          callerId: data.callerId,
          recipientId: user.walletAddress,
          type: data.callType,
          status: 'ringing',
          startTime: Date.now(),
        });

        // Store caller info
        sessionStorage.setItem('incomingCallInfo', JSON.stringify({
          callerName,
          callType: data.callType,
          autoAnswer: true, // Signal to auto-answer
        }));

        onAnswerCallRef.current?.(data);

      } else if (data.action === 'decline') {
        console.log('📞 User tapped DECLINE from notification');
        webSocketService.emit('call:decline', { callId: data.callId });
        onDeclineCallRef.current?.(data);

      } else {
        // Just opened from notification tap (not answer/decline button)
        console.log('📞 User tapped notification (showing call modal)');
        
        setIncomingCallRef.current({
          id: data.callId,
          callerId: data.callerId,
          recipientId: user.walletAddress,
          type: data.callType,
          status: 'ringing',
          startTime: Date.now(),
        });

        sessionStorage.setItem('incomingCallInfo', JSON.stringify({
          callerName,
          callType: data.callType,
          autoAnswer: false,
        }));

        onIncomingCallRef.current?.(data);
      }
    };

    // Listen for native events
    window.addEventListener('incomingCallFromNotification', handleNativeCallEvent as EventListener);

    // On native platforms, check for pending call data on startup
    if (Capacitor.isNativePlatform()) {
      checkForPendingCallData();
    }

    return () => {
      window.removeEventListener('incomingCallFromNotification', handleNativeCallEvent as EventListener);
      globalListenersSetUp = false;
      hasSetupRef.current = false;
    };
  }, [enabled, currentUser?.walletAddress]);
  // Dependencies kept minimal - refs handle the rest

  return { notifyAnswered, notifyDeclined };
}

/**
 * Check for pending call data from native (when app was launched from notification)
 */
async function checkForPendingCallData() {
  try {
    // This is called via Capacitor bridge
    const { Plugins } = await import('@capacitor/core');
    
    // Try to get pending data from native
    // This requires a custom plugin or using the App plugin's getLaunchUrl
    const appPlugin = (Plugins as any).App;
    if (appPlugin?.getLaunchUrl) {
      const launchUrl = await appPlugin.getLaunchUrl();
      console.log('📞 Launch URL:', launchUrl);
    }
  } catch (error) {
    // Silently handle - no pending call data
  }
}

/**
 * Hook for handling message notifications
 */
let globalMessageListenersSetUp = false;

export function useMessageFromNotification(options: { 
  onOpenConversation?: (conversationId: string) => void;
  enabled?: boolean;
} = {}) {
  const { onOpenConversation, enabled = true } = options;
  const { setActiveConversation } = useAppStore();
  const hasSetupRef = useRef(false);
  
  // Use ref to avoid re-running effect when callback changes
  const onOpenConversationRef = useRef(onOpenConversation);
  const setActiveConversationRef = useRef(setActiveConversation);
  
  useEffect(() => {
    onOpenConversationRef.current = onOpenConversation;
    setActiveConversationRef.current = setActiveConversation;
  });

  useEffect(() => {
    if (!enabled) return;
    
    // Prevent duplicate setups
    if (hasSetupRef.current || globalMessageListenersSetUp) {
      hasSetupRef.current = true;
      return;
    }
    
    hasSetupRef.current = true;
    globalMessageListenersSetUp = true;

    const handleMessageEvent = (event: CustomEvent<{ conversationId: string }>) => {
      const { conversationId } = event.detail;
      
      console.log('💬 Opening conversation from notification:', conversationId);
      
      setActiveConversationRef.current(conversationId);
      onOpenConversationRef.current?.(conversationId);
    };

    window.addEventListener('openConversationFromNotification', handleMessageEvent as EventListener);

    return () => {
      window.removeEventListener('openConversationFromNotification', handleMessageEvent as EventListener);
      globalMessageListenersSetUp = false;
      hasSetupRef.current = false;
    };
  }, [enabled]);
}
