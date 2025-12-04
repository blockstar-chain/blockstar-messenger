import React, { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import { webSocketService } from '@/lib/websocket';
import { webRTCService } from '@/lib/webrtc';
import { syncFromServer } from '@/lib/syncService';
import { db } from '@/lib/database';
import toast, { Toaster } from 'react-hot-toast';
import Sidebar from './Sidebar';
import ChatArea from './ChatArea';
import CallModal from './CallModal';
import GroupCallModal from './GroupCallModal';
import IncomingCallModal from './IncomingCallModal';

export default function MainLayout() {
  const { 
    currentUser, 
    isAuthenticated, 
    isSidebarOpen, 
    setIncomingCall,
    activeCall,
    setActiveCall,
    setCallModalOpen,
    setConversations,
  } = useAppStore();
  
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

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
          // Don't show error toast - user can still use local data
        }
      } catch (error) {
        console.error('Sync error:', error);
        setSyncError(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setIsSyncing(false);
      }
    };

    // Perform initial sync
    performSync();
    
    // Also sync periodically (every 5 minutes)
    const syncInterval = setInterval(performSync, 5 * 60 * 1000);
    
    return () => clearInterval(syncInterval);
  }, [isAuthenticated, currentUser, setConversations]);

  // Setup call handlers
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;

    console.log('🔧 Setting up call handlers for:', currentUser.walletAddress);

    // Handle incoming calls (call:incoming event)
    const unsubscribeIncoming = webSocketService.on('call:incoming', (data: any) => {
      console.log('========================================');
      console.log('📞 INCOMING CALL received');
      console.log('   Call ID:', data.callId);
      console.log('   Caller:', data.callerId);
      console.log('   Type:', data.callType);
      console.log('   Has offer:', !!data.offer);
      console.log('========================================');
      
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

        // Store the offer signal to process when answering
        sessionStorage.setItem('incomingCallOffer', JSON.stringify(data.offer));
        console.log('📞 Stored offer in sessionStorage');
      }
    });

    // Handle call answers (for outgoing calls - caller receives this)
    const unsubscribeAnswer = webSocketService.on('call:answer', (data: any) => {
      console.log('========================================');
      console.log('📞 CALL ANSWER received in MainLayout');
      console.log('   Call ID:', data.callId);
      console.log('   From:', data.from);
      console.log('   Has answer:', !!data.answer);
      console.log('   Answer type:', data.answer?.type);
      console.log('========================================');
      
      const { activeCall: currentActiveCall } = useAppStore.getState();
      
      console.log('📞 Current active call:', currentActiveCall?.id);
      console.log('📞 Call ID match:', data.callId === currentActiveCall?.id);
      
      if (data.answer && currentActiveCall && data.callId === currentActiveCall.id) {
        console.log('📞 Processing answer signal for call:', data.callId);
        
        try {
          webRTCService.processSignal(currentActiveCall.id, data.answer);
          console.log('📞 Answer signal processed successfully');
          
          // Update call status to active
          const updatedCall = { ...currentActiveCall, status: 'active' as const };
          setActiveCall(updatedCall);
          
          toast.success('📞 Call connected!');
        } catch (error) {
          console.error('📞 Error processing answer signal:', error);
          toast.error('Failed to connect call');
        }
      } else {
        console.log('📞 NOT processing answer:', {
          hasAnswer: !!data.answer,
          hasActiveCall: !!currentActiveCall,
          callIdMatch: data.callId === currentActiveCall?.id,
          expectedId: currentActiveCall?.id,
          receivedId: data.callId
        });
      }
    });

    // Handle ICE candidates
    const unsubscribeIce = webSocketService.on('call:ice-candidate', (data: any) => {
      const { activeCall: currentActiveCall, incomingCall: currentIncomingCall } = useAppStore.getState();
      
      console.log('🧊 ICE candidate received:', { 
        from: data.from, 
        callId: data.callId, 
        hasCandidate: !!data.candidate,
        activeCallId: currentActiveCall?.id,
        incomingCallId: currentIncomingCall?.id,
      });
      
      // Determine which call this ICE candidate belongs to
      const targetCallId = data.callId || currentActiveCall?.id || currentIncomingCall?.id;
      
      if (targetCallId && data.candidate) {
        console.log('🧊 Adding ICE candidate to call:', targetCallId);
        webRTCService.addIceCandidate(targetCallId, data.candidate);
      } else {
        console.warn('⚠️ Could not process ICE candidate - no matching call');
      }
    });

    // Handle remote stream - this means connection is established
    const unsubscribeStream = webRTCService.onStream((stream, callId) => {
      console.log('========================================');
      console.log('🎥 REMOTE STREAM received in MainLayout');
      console.log('   Call ID:', callId);
      console.log('   Stream active:', stream.active);
      console.log('   Audio tracks:', stream.getAudioTracks().length);
      console.log('   Video tracks:', stream.getVideoTracks().length);
      console.log('========================================');
      
      const { activeCall: currentActiveCall } = useAppStore.getState();
      
      if (currentActiveCall && currentActiveCall.id === callId) {
        console.log('🎥 Call IDs match, updating status to ACTIVE');
        const updatedCall = { ...currentActiveCall, status: 'active' as const };
        setActiveCall(updatedCall);
        toast.success('🎉 Call connected!');
      } else {
        console.log('🎥 Call ID mismatch:', {
          streamCallId: callId,
          activeCallId: currentActiveCall?.id,
        });
      }
    });

    // Monitor connection state for debugging
    const unsubscribeConnectionState = webRTCService.onConnectionState((state, callId) => {
      console.log(`🔗 WebRTC connection state for ${callId}: ${state}`);
      
      if (state === 'connected') {
        toast.success('WebRTC connected!', { duration: 2000 });
      } else if (state === 'failed') {
        toast.error('Connection failed. Try checking your network or firewall.', { duration: 5000 });
      } else if (state === 'disconnected') {
        toast.error('Connection lost. Attempting to reconnect...', { duration: 3000 });
      }
    });

    // Listen for call:ended events
    const handleCallEnded = webSocketService.on('call:ended', (data: any) => {
      console.log('📞 Call ended event:', data);
      toast.error('Call ended');
      webRTCService.cleanup();
      setActiveCall(null);
      setIncomingCall(null);
      setCallModalOpen(false);
    });

    // Listen for call:unavailable events
    // Don't immediately end the call - user might come online
    // The call will timeout after 60 seconds if no answer
    const handleUnavailable = webSocketService.on('call:unavailable', (data: any) => {
      console.log('📞 call:unavailable:', data);
      // Don't end the call - just log and continue ringing
      // The CallModal's 60-second timeout will handle ending the call
      const { activeCall: currentCall } = useAppStore.getState();
      if (currentCall) {
        console.log('📞 User currently unavailable, call will continue ringing...');
        toast('User appears offline, trying to reach them...', { 
          icon: '📞', 
          duration: 3000,
          id: 'call-status' // Prevent duplicate toasts
        });
      }
    });

    // Listen for call:status updates
    const handleCallStatus = webSocketService.on('call:status', (data: any) => {
      console.log('📞 call:status:', data);
      if (data.status === 'ringing-offline') {
        toast('User is offline - they may receive a notification', { 
          icon: '📱', 
          duration: 4000,
          id: 'call-status'
        });
      }
    });

    // ================================
    // GROUP CALL EVENT HANDLERS
    // ================================

    // Handle incoming group call
    const unsubscribeGroupCallIncoming = webSocketService.on('group:call:incoming', async (data: any) => {
      console.log('========================================');
      console.log('📞 INCOMING GROUP CALL');
      console.log('   Data:', data);
      console.log('========================================');
      
      const { callId, callType, offer, callerAddress, groupId, groupName, participants, peerId } = data;
      
      // Store the offer signal to process when answering
      if (offer) {
        sessionStorage.setItem('incomingCallOffer', JSON.stringify(offer));
      }
      
      // Show incoming call UI
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
        peerId, // Store peerId for answering
      } as any);
      
      toast(`📞 Incoming ${callType} call from ${groupName || 'Group'}!`, { duration: 10000 });
    });

    // Handle group call answer
    const unsubscribeGroupCallAnswer = webSocketService.on('group:call:answer', (data: any) => {
      console.log('📞 Group call answer received:', data);
      const { activeCall: currentActiveCall } = useAppStore.getState();
      
      const { answer, peerId, fromAddress, callId } = data;
      
      if (answer && currentActiveCall && callId === currentActiveCall.id) {
        console.log('📞 Processing group call answer from:', fromAddress);
        webRTCService.processSignal(peerId, answer);
        toast.success(`${fromAddress.substring(0, 6)}... joined the call`);
      }
    });

    // Handle group call ICE candidate
    const unsubscribeGroupCallIce = webSocketService.on('group:call:ice-candidate', (data: any) => {
      const { candidate, peerId, callId } = data;
      console.log('🧊 Group call ICE candidate for peer:', peerId);
      
      if (peerId && candidate) {
        webRTCService.addIceCandidate(peerId, candidate);
      }
    });

    // Handle group call ended
    const unsubscribeGroupCallEnd = webSocketService.on('group:call:ended', (data: any) => {
      console.log('📞 Group call ended:', data);
      toast.error('Group call ended');
      webRTCService.cleanup();
      setActiveCall(null);
      setIncomingCall(null);
      setCallModalOpen(false);
    });

    // Handle participant left group call
    const unsubscribeGroupCallParticipantLeft = webSocketService.on('group:call:participant:left', (data: any) => {
      console.log('📞 Participant left group call:', data);
      toast(`${data.address?.substring(0, 6)}... left the call`, { icon: '👋' });
    });

    return () => {
      console.log('🧹 Cleaning up call handlers');
      unsubscribeIncoming();
      unsubscribeAnswer();
      unsubscribeIce();
      unsubscribeStream();
      unsubscribeConnectionState();
      handleCallEnded();
      handleUnavailable();
      handleCallStatus();
      // Group call cleanup
      unsubscribeGroupCallIncoming();
      unsubscribeGroupCallAnswer();
      unsubscribeGroupCallIce();
      unsubscribeGroupCallEnd();
      unsubscribeGroupCallParticipantLeft();
    };
  }, [isAuthenticated, currentUser, setIncomingCall, setActiveCall, setCallModalOpen]);

  // Update user status to online when component mounts
  useEffect(() => {
    if (isAuthenticated && currentUser) {
      // Send online status immediately
      webSocketService.updateStatus('online');

      // Set status to away on blur, online on focus
      const handleVisibilityChange = () => {
        if (document.hidden) {
          webSocketService.updateStatus('away');
        } else {
          webSocketService.updateStatus('online');
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      // Also handle focus/blur
      const handleFocus = () => webSocketService.updateStatus('online');
      const handleBlur = () => webSocketService.updateStatus('away');
      
      window.addEventListener('focus', handleFocus);
      window.addEventListener('blur', handleBlur);

      // Set offline on unload
      const handleUnload = () => {
        webSocketService.updateStatus('offline');
      };

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

  return (
    <div className="flex h-screen bg-midnight">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#06060c',
            color: '#fff',
            border: '1px solid #12121f',
            borderRadius: '12px',
          },
          success: {
            iconTheme: {
              primary: '#00d67f',
              secondary: '#fff',
            },
          },
          error: {
            iconTheme: {
              primary: '#ff3b5c',
              secondary: '#fff',
            },
          },
        }}
      />
      
      {/* Sidebar */}
      <div className={`${isSidebarOpen ? 'block' : 'hidden'} lg:block`}>
        <Sidebar />
      </div>
      
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <ChatArea />
      </div>

      {/* Call modals */}
      <CallModal />
      <GroupCallModal />
      <IncomingCallModal />
    </div>
  );
}
