import React, { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import { webSocketService } from '@/lib/websocket';
import { webRTCService } from '@/lib/webrtc';
import { syncFromServer } from '@/lib/syncService';
import { db } from '@/lib/database';
import toast from 'react-hot-toast';
import Sidebar from './Sidebar';
import ChatArea from './ChatArea';
import CallModal from './CallModal';
import GroupCallModal from './GroupCallModal';
import IncomingCallModal from './IncomingCallModal';
import MobileBottomNav, { MobileTab } from './MobileBottomNav';
import {
  initializePushNotifications,
} from '@/lib/pushNotifications';
import { useAuthSession } from '@/hooks/useAutoLogin';
import { 
  setUnreadMessageCount, 
  requestNotificationPermission,
  showIncomingCallNotification,
  initializeLocalNotifications 
} from '@/lib/notificationService';
import { handleCallMissed } from '@/lib/missedCallService';
import { useIncomingCallFromNotification, useMessageFromNotification } from '@/hooks/useIncomingCallFromNotification';
import { Capacitor } from '@capacitor/core';

export default function MainLayout() {
  const {
    currentUser,
    isAuthenticated,
    isSidebarOpen,
    setIncomingCall,
    setActiveCall,
    setCallModalOpen,
    setConversations,
    activeConversationId,
    setActiveConversation,
    conversations,
    incomingCall,
  } = useAppStore();

  // ========================================
  // AUTO-LOGIN: This MUST run first!
  // ========================================
  const { isChecking: isCheckingAuth, isRestored } = useAuthSession();

  // ========================================
  // HANDLE CALLS/MESSAGES FROM NOTIFICATIONS
  // Only enable AFTER auth check is complete
  // ========================================
  const { notifyAnswered, notifyDeclined } = useIncomingCallFromNotification({
    enabled: !isCheckingAuth && !!currentUser?.walletAddress,
    onIncomingCall: (data) => {
      console.log('📞 Incoming call from notification:', data);
      toast(`📞 Incoming ${data.callType} call from ${data.callerName}`, { duration: 5000 });
    },
    onAnswerCall: (data) => {
      console.log('📞 Auto-answering call from notification');
      // The modal will check sessionStorage for autoAnswer flag
    },
    onDeclineCall: (data) => {
      console.log('📞 Call declined from notification');
      toast('Call declined', { duration: 2000 });
    },
  });

  // Handle message notifications opening conversations
  useMessageFromNotification({
    enabled: !isCheckingAuth && !!currentUser?.walletAddress,
    onOpenConversation: (conversationId) => {
      console.log('💬 Opening conversation from notification:', conversationId);
      setIsInChat(true);
    },
  });

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Mobile navigation state
  const [mobileTab, setMobileTab] = useState<MobileTab>('messages');
  const [isInChat, setIsInChat] = useState(false);

  // Sidebar tab state (messages vs contacts) - lifted up for mobile nav control
  const [sidebarTab, setSidebarTab] = useState<'messages' | 'contacts'>('messages');

  // Settings modal state - lifted up for mobile nav
  const [showSettings, setShowSettings] = useState(false);

  // New chat modal state - lifted up for mobile nav
  const [showNewChat, setShowNewChat] = useState(false);

  // Mesh modal state - lifted up for mobile nav
  const [showMesh, setShowMesh] = useState(false);

  // Calculate total unread count
  const totalUnread = conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);

  // ========================================
  // UPDATE APP BADGE when unread count changes
  // ========================================
  useEffect(() => {
    setUnreadMessageCount(totalUnread);
  }, [totalUnread]);

  // ========================================
  // INITIALIZE NOTIFICATIONS on app start
  // ========================================
  useEffect(() => {
    const initNotifications = async () => {
      // Request browser notification permission
      await requestNotificationPermission();
      
      // Initialize local notifications for native
      if (Capacitor.isNativePlatform()) {
        await initializeLocalNotifications();
      }
    };
    
    if (currentUser?.walletAddress) {
      initNotifications();
    }
  }, [currentUser?.walletAddress]);

  // Handle mobile tab changes
  const handleMobileTabChange = (tab: MobileTab) => {
    if (tab === 'new') {
      setShowNewChat(true);
      return;
    }
    if (tab === 'settings') {
      setShowSettings(true);
      return;
    }
    if (tab === 'mesh') {
      setShowMesh(true);
      return;
    }
    if (tab === 'messages') {
      setSidebarTab('messages');
      setIsInChat(false);
    }
    if (tab === 'contacts') {
      setSidebarTab('contacts');
      setIsInChat(false);
    }
    setMobileTab(tab);
  };

  // When a conversation is selected, switch to chat view on mobile
  const handleConversationSelect = () => {
    setIsInChat(true);
  };

  // Go back to sidebar on mobile
  const handleBackToList = () => {
    setIsInChat(false);
    setActiveConversation(null);
  };

  // When activeConversationId changes, update isInChat
  useEffect(() => {
    if (activeConversationId) {
      setIsInChat(true);
    }
  }, [activeConversationId]);

  // Sync data from server on startup
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;

    const performSync = async () => {
      setIsSyncing(true);
      setSyncError(null);

      try {
        console.log('🔄 Syncing data from server...');
        const result = await syncFromServer(currentUser.walletAddress);

        if (result.success) {
          console.log(`✅ Synced ${result.conversationsCount} conversations, ${result.messagesCount} messages`);

          // Reload conversations into store, filtering out invalid "Group Chat" groups
          let conversations = await db.conversations.toArray();

          // Filter out groups with invalid names
          conversations = conversations.filter(conv => {
            if (conv.type === 'group') {
              const groupName = (conv as any).groupName;
              if (!groupName || groupName === 'Group Chat') {
                console.log(`⚠️ Filtering out invalid group from sync:`, conv.id);
                return false;
              }
            }
            return true;
          });

          const sorted = conversations.sort((a, b) => b.updatedAt - a.updatedAt);
          setConversations(sorted);

          if (result.messagesCount > 0) {
            toast.success(`Synced ${result.messagesCount} messages`);
          }
        } else {
          console.warn('⚠️ Sync failed:', result.error);
          setSyncError(result.error || 'Sync failed');
        }
      } catch (error) {
        console.error('Sync error:', error);
        setSyncError(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setIsSyncing(false);
      }
    };

    performSync();
    const syncInterval = setInterval(performSync, 5 * 60 * 1000);
    return () => clearInterval(syncInterval);
  }, [isAuthenticated, currentUser, setConversations]);

  // Setup call handlers
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;

    console.log('🔧 Setting up call handlers for:', currentUser.walletAddress);

    // Track if we have an unanswered incoming call (for missed call detection)
    let currentIncomingCallId: string | null = null;
    let currentIncomingCallData: any = null;

    const unsubscribeIncoming = webSocketService.on('call:incoming', (data: any) => {
      console.log('📞 INCOMING CALL received:', data.callId);

      if (data.offer && data.callerId && data.callerId.toLowerCase() !== currentUser.walletAddress.toLowerCase()) {
        // Store for missed call tracking
        currentIncomingCallId = data.callId;
        currentIncomingCallData = data;

        toast('📞 Incoming call...', { icon: '📞', duration: 5000 });

        setIncomingCall({
          id: data.callId,
          callerId: data.callerId,
          recipientId: currentUser.walletAddress,
          type: data.callType || 'audio',
          status: 'ringing',
          startTime: Date.now(),
        });

        sessionStorage.setItem('incomingCallOffer', JSON.stringify(data.offer));

        // Show browser notification (for desktop)
        showIncomingCallNotification(
          data.callerName || data.callerId?.substring(0, 10) + '...',
          data.callerId,
          data.callId,
          data.callType || 'audio'
        );
      }
    });

    const unsubscribeAnswer = webSocketService.on('call:answer', (data: any) => {
      const { activeCall: currentActiveCall } = useAppStore.getState();

      if (data.answer && currentActiveCall && data.callId === currentActiveCall.id) {
        try {
          webRTCService.processSignal(currentActiveCall.id, data.answer);
          const updatedCall = { ...currentActiveCall, status: 'active' as const };
          setActiveCall(updatedCall);
          toast.success('📞 Call connected!');
        } catch (error) {
          console.error('Error processing answer:', error);
          toast.error('Failed to connect call');
        }
      }
    });

    const unsubscribeIce = webSocketService.on('call:ice-candidate', (data: any) => {
      const { activeCall: currentActiveCall, incomingCall: currentIncomingCall } = useAppStore.getState();
      const targetCallId = data.callId || currentActiveCall?.id || currentIncomingCall?.id;

      if (targetCallId && data.candidate) {
        webRTCService.addIceCandidate(targetCallId, data.candidate);
      }
    });

    const unsubscribeStream = webRTCService.onStream((stream, callId) => {
      const { activeCall: currentActiveCall } = useAppStore.getState();

      if (currentActiveCall && currentActiveCall.id === callId) {
        const updatedCall = { ...currentActiveCall, status: 'active' as const };
        setActiveCall(updatedCall);
        toast.success('🎉 Call connected!');
      }
    });

    const unsubscribeConnectionState = webRTCService.onConnectionState((state, callId) => {
      console.log(`🔗 WebRTC connection state for ${callId}: ${state}`);

      if (state === 'connected') {
        toast.success('WebRTC connected!', { duration: 2000 });
      } else if (state === 'failed') {
        toast.error('Connection failed.', { duration: 5000 });
      }
    });

    const handleCallEnded = webSocketService.on('call:ended', (data: any) => {
      // Check if this was an unanswered incoming call (missed call)
      if (currentIncomingCallId === data.callId && currentIncomingCallData) {
        console.log('📵 Call ended without answer - recording as missed call');
        handleCallMissed(
          currentIncomingCallData.callerId,
          currentIncomingCallData.callerName || currentIncomingCallData.callerId?.substring(0, 10) + '...',
          currentIncomingCallData.callType || 'audio'
        );
      }

      // Clear tracking
      currentIncomingCallId = null;
      currentIncomingCallData = null;

      toast.error('Call ended');
      webRTCService.cleanup();
      setActiveCall(null);
      setIncomingCall(null);
      setCallModalOpen(false);
    });

    const handleUnavailable = webSocketService.on('call:unavailable', (data: any) => {
      const { activeCall: currentCall } = useAppStore.getState();
      if (currentCall) {
        toast.error('User is unavailable');
        webRTCService.cleanup();
        setActiveCall(null);
        setCallModalOpen(false);
      }
    });

    const handleCallStatus = webSocketService.on('call:status', (data: any) => {
      console.log('📞 Call status update:', data);
    });

    // Group call handlers
    const unsubscribeGroupCallIncoming = webSocketService.on('group:call:incoming', (data: any) => {
      const { callId, groupId, initiatorId, callType, offer, groupName } = data;

      if (initiatorId.toLowerCase() === currentUser.walletAddress.toLowerCase()) {
        return;
      }

      setIncomingCall({
        id: callId,
        callerId: initiatorId,
        recipientId: groupId,
        type: callType || 'audio',
        status: 'ringing',
        startTime: Date.now(),
        isGroup: true,
        groupId: groupId,
      });

      sessionStorage.setItem('incomingCallOffer', JSON.stringify(offer));
      sessionStorage.setItem('incomingGroupCallData', JSON.stringify({
        groupId,
        groupName,
        initiatorId,
      }));

      toast(`📞 Incoming ${callType} call from ${groupName || 'Group'}!`, { duration: 10000 });
    });

    const unsubscribeGroupCallAnswer = webSocketService.on('group:call:answer', (data: any) => {
      const { activeCall: currentActiveCall } = useAppStore.getState();
      const { answer, peerId, fromAddress, callId } = data;

      if (answer && currentActiveCall && callId === currentActiveCall.id) {
        webRTCService.processSignal(peerId, answer);
        toast.success(`${fromAddress.substring(0, 6)}... joined the call`);
      }
    });

    const unsubscribeGroupCallIce = webSocketService.on('group:call:ice-candidate', (data: any) => {
      const { candidate, peerId } = data;
      if (peerId && candidate) {
        webRTCService.addIceCandidate(peerId, candidate);
      }
    });

    const unsubscribeGroupCallEnd = webSocketService.on('group:call:ended', (data: any) => {
      toast.error('Group call ended');
      webRTCService.cleanup();
      setActiveCall(null);
      setIncomingCall(null);
      setCallModalOpen(false);
    });

    const unsubscribeGroupCallParticipantLeft = webSocketService.on('group:call:participant:left', (data: any) => {
      toast(`${data.address?.substring(0, 6)}... left the call`, { icon: '👋' });
    });

    return () => {
      unsubscribeIncoming();
      unsubscribeAnswer();
      unsubscribeIce();
      unsubscribeStream();
      unsubscribeConnectionState();
      handleCallEnded();
      handleUnavailable();
      handleCallStatus();
      unsubscribeGroupCallIncoming();
      unsubscribeGroupCallAnswer();
      unsubscribeGroupCallIce();
      unsubscribeGroupCallEnd();
      unsubscribeGroupCallParticipantLeft();
    };
  }, [isAuthenticated, currentUser, setIncomingCall, setActiveCall, setCallModalOpen]);

  // Update user status
  useEffect(() => {
    if (isAuthenticated && currentUser) {
      webSocketService.updateStatus('online');

      const handleVisibilityChange = () => {
        webSocketService.updateStatus(document.hidden ? 'away' : 'online');
      };

      const handleFocus = () => webSocketService.updateStatus('online');
      const handleBlur = () => webSocketService.updateStatus('away');
      const handleUnload = () => webSocketService.updateStatus('offline');

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleFocus);
      window.addEventListener('blur', handleBlur);
      window.addEventListener('beforeunload', handleUnload);

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('blur', handleBlur);
        window.removeEventListener('beforeunload', handleUnload);
        webSocketService.updateStatus('offline');
      };
    }
  }, [isAuthenticated, currentUser]);

  // Push notifications setup
  useEffect(() => {
    const initPush = async () => {
      console.log("initPush ==========");
      console.log("currentUser" , currentUser);
      // Only initialize if we have a wallet and on native platform
      if (!currentUser) {
        return;
      }

      console.log('📱 Initializing push notifications for:', currentUser.walletAddress);

      const success = await initializePushNotifications(
        currentUser.walletAddress,
        {
          // Handle incoming call from push notification
          onIncomingCall: (callData) => {
            console.log('📞 Incoming call from PUSH:', callData);

            // Set the incoming call state - this triggers your IncomingCallModal
            setIncomingCall({
              id: callData.callId,
              callerId: callData.callerId,
              recipientId: currentUser.walletAddress,
              type: callData.callType === 'video' ? 'video' : 'audio',
              status: 'ringing',
              startTime: Date.now(),
            });

            // Store caller info for display
            sessionStorage.setItem('incomingCallInfo', JSON.stringify({
              callerName: callData.callerName,
              callerAvatar: callData.callerAvatar,
              conversationId: callData.conversationId,
            }));

            // Show toast notification
            toast(`📞 Incoming ${callData.callType} call from ${callData.callerName}`, {
              icon: '📞',
              duration: 10000,
            });
          },

          // Handle message notification (optional)
          onMessage: (messageData) => {
            console.log('💬 New message notification:', messageData);

            // Show toast for new message
            toast(`${messageData.senderName}: ${messageData.messagePreview}`, {
              duration: 5000,
            });
          },

          // Handle missed call notification (optional)
          onMissedCall: (missedCallData) => {
            console.log('📵 Missed call:', missedCallData);

            toast(`Missed ${missedCallData.callType} call from ${missedCallData.callerName}`, {
              icon: '📵',
              duration: 5000,
            });
          },

          // Handle notification tapped (app opened from notification)
          onNotificationTapped: (data) => {
            console.log('📱 Notification tapped, data:', data);

            // Navigate based on notification type
            if (data.type === 'message' && data.conversationId) {
              // Navigate to the conversation
              // router.push(`/chat/${data.conversationId}`);
            }
          },
        }
      );

      if (success) {
        console.log('✅ Push notifications initialized');
      } else {
        console.log('⚠️ Push notifications not available (web or permission denied)');
      }
    };

    initPush();
  }, [currentUser?.walletAddress, setIncomingCall]);

  // ========================================
  // LOADING SCREEN - while checking auth
  // ========================================
  if (isCheckingAuth) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-midnight">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4">
            <div className="animate-pulse bg-cyan-500 rounded-full w-16 h-16 flex items-center justify-center">
              <span className="text-white text-2xl font-bold">B</span>
            </div>
          </div>
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  // ========================================
  // NOT AUTHENTICATED - parent handles login
  // ========================================
  if (!isAuthenticated || !currentUser) {
    return null;
  }

  return (
    <div className="flex h-[100dvh] bg-midnight overflow-hidden">

      {/* Desktop Layout: Sidebar always visible */}
      <div className="hidden md:flex md:w-80 lg:w-96 flex-shrink-0 h-full">
        <Sidebar
          onConversationSelect={handleConversationSelect}
          activeTab={sidebarTab}
          onTabChange={setSidebarTab}
          showSettingsModal={showSettings}
          onSettingsModalChange={setShowSettings}
          showNewChatModal={showNewChat}
          onNewChatModalChange={setShowNewChat}
          showMeshModal={showMesh}
          onMeshModalChange={setShowMesh}
        />
      </div>

      {/* Desktop: Chat area */}
      <div className="hidden md:flex flex-1 flex-col min-w-0 h-full">
        <ChatArea />
      </div>

      {/* Mobile Layout */}
      <div className="flex md:hidden flex-col w-full h-full">
        {/* Mobile: Either sidebar or chat, with bottom nav space */}
        <div className="flex-1 overflow-hidden pb-16">
          {isInChat && activeConversationId ? (
            <ChatArea onBackClick={handleBackToList} />
          ) : (
            <Sidebar
              onConversationSelect={handleConversationSelect}
              activeTab={sidebarTab}
              onTabChange={setSidebarTab}
              showSettingsModal={showSettings}
              onSettingsModalChange={setShowSettings}
              showNewChatModal={showNewChat}
              onNewChatModalChange={setShowNewChat}
              showMeshModal={showMesh}
              onMeshModalChange={setShowMesh}
              isMobile={true}
            />
          )}
        </div>

        {/* Mobile Bottom Navigation - hide when in chat */}
        {!isInChat && (
          <MobileBottomNav
            activeTab={mobileTab}
            onTabChange={handleMobileTabChange}
            unreadCount={totalUnread}
          />
        )}
      </div>

      {/* Call modals */}
      <CallModal />
      <GroupCallModal />
      <IncomingCallModal />
    </div>
  );
}
