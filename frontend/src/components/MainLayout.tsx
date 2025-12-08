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
  unregisterPushNotifications,
  updatePushCallbacks,
  isNative as isPushNative
} from '@/lib/pushNotifications';

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
  } = useAppStore();

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

    const unsubscribeIncoming = webSocketService.on('call:incoming', (data: any) => {
      console.log('📞 INCOMING CALL received:', data.callId);

      if (data.offer && data.callerId && data.callerId.toLowerCase() !== currentUser.walletAddress.toLowerCase()) {
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
      toast.error('Call ended');
      webRTCService.cleanup();
      setActiveCall(null);
      setIncomingCall(null);
      setCallModalOpen(false);
    });

    const handleUnavailable = webSocketService.on('call:unavailable', (data: any) => {
      const { activeCall: currentCall } = useAppStore.getState();
      if (currentCall) {
        toast('User appears offline, trying to reach them...', {
          icon: '📞',
          duration: 3000,
          id: 'call-status'
        });
      }
    });

    const handleCallStatus = webSocketService.on('call:status', (data: any) => {
      if (data.status === 'ringing-offline') {
        toast('User is offline - they may receive a notification', {
          icon: '📱',
          duration: 4000,
          id: 'call-status'
        });
      }
    });

    // Group call handlers
    const unsubscribeGroupCallIncoming = webSocketService.on('group:call:incoming', async (data: any) => {
      const { callId, callType, offer, callerAddress, groupName, participants, peerId } = data;

      if (offer) {
        sessionStorage.setItem('incomingCallOffer', JSON.stringify(offer));
      }

      setIncomingCall({
        id: callId,
        callerId: callerAddress,
        recipientId: currentUser?.walletAddress || '',
        type: callType,
        status: 'ringing',
        startTime: Date.now(),
        isGroupCall: true,
        participants,
        groupName: groupName || 'Group Call',
        peerId,
      } as any);

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

  if (!isAuthenticated || !currentUser) {
    return null;
  }

  useEffect(() => {
    const initPush = async () => {
      // Only initialize if we have a wallet and on native platform
      if (!currentUser?.walletAddress || !isPushNative) {
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
            // You might need to adjust this based on your state management
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

            // Optionally navigate to conversation
            // router.push(`/chat/${messageData.conversationId}`);
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

    // Cleanup on unmount (but not on logout - that's handled separately)
  }, [currentUser?.walletAddress]);

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
