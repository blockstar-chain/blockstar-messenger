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

export function useIncomingCallFromNotification(options: UseIncomingCallFromNotificationOptions = {}) {
  const { onIncomingCall, onAnswerCall, onDeclineCall, enabled = true } = options;
  const { setIncomingCall, currentUser } = useAppStore();
  const processedCallIds = useRef<Set<string>>(new Set());
  
  // Use refs for callbacks to avoid re-running the effect when callbacks change
  // This prevents the excessive re-render issue
  const onIncomingCallRef = useRef(onIncomingCall);
  const onAnswerCallRef = useRef(onAnswerCall);
  const onDeclineCallRef = useRef(onDeclineCall);
  
  // Keep refs updated
  useEffect(() => {
    onIncomingCallRef.current = onIncomingCall;
    onAnswerCallRef.current = onAnswerCall;
    onDeclineCallRef.current = onDeclineCall;
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
    if (!enabled || !currentUser?.walletAddress) {
      // Only log once when not enabled
      return;
    }

    console.log('📞 useIncomingCallFromNotification: Setting up listeners');

    // Handler for native events
    const handleNativeCallEvent = (event: CustomEvent<PendingCallData>) => {
      const data = event.detail;
      
      console.log('═══════════════════════════════════════');
      console.log('📞 INCOMING CALL FROM NOTIFICATION');
      console.log('  Call ID:', data.callId);
      console.log('  Caller:', data.callerName);
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

      // Handle based on action
      if (data.action === 'answer') {
        console.log('📞 User tapped ANSWER from notification');
        
        // Set incoming call state so the modal shows
        setIncomingCall({
          id: data.callId,
          callerId: data.callerId,
          recipientId: currentUser.walletAddress,
          type: data.callType,
          status: 'ringing',
          startTime: Date.now(),
        });

        // Store caller info
        sessionStorage.setItem('incomingCallInfo', JSON.stringify({
          callerName: data.callerName,
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
        
        setIncomingCall({
          id: data.callId,
          callerId: data.callerId,
          recipientId: currentUser.walletAddress,
          type: data.callType,
          status: 'ringing',
          startTime: Date.now(),
        });

        sessionStorage.setItem('incomingCallInfo', JSON.stringify({
          callerName: data.callerName,
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
    };
  }, [enabled, currentUser?.walletAddress, setIncomingCall]);
  // REMOVED: onIncomingCall, onAnswerCall, onDeclineCall, notifyDeclined from deps
  // These are now accessed via refs to prevent re-running the effect

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
    console.log('📞 No pending call data from native');
  }
}

/**
 * Hook for handling message notifications
 */
export function useMessageFromNotification(options: { 
  onOpenConversation?: (conversationId: string) => void;
  enabled?: boolean;
} = {}) {
  const { onOpenConversation, enabled = true } = options;
  const { setActiveConversation } = useAppStore();
  
  // Use ref to avoid re-running effect when callback changes
  const onOpenConversationRef = useRef(onOpenConversation);
  useEffect(() => {
    onOpenConversationRef.current = onOpenConversation;
  });

  useEffect(() => {
    if (!enabled) return;

    const handleMessageEvent = (event: CustomEvent<{ conversationId: string }>) => {
      const { conversationId } = event.detail;
      
      console.log('💬 Opening conversation from notification:', conversationId);
      
      setActiveConversation(conversationId);
      onOpenConversationRef.current?.(conversationId);
    };

    window.addEventListener('openConversationFromNotification', handleMessageEvent as EventListener);

    return () => {
      window.removeEventListener('openConversationFromNotification', handleMessageEvent as EventListener);
    };
  }, [enabled, setActiveConversation]);
  // REMOVED: onOpenConversation from deps - accessed via ref
}
