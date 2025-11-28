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
          
          // Reload conversations into store
          const conversations = await db.conversations.toArray();
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

    // Handle incoming calls (call:incoming event)
    const unsubscribeIncoming = webSocketService.on('call:incoming', (data: any) => {
      console.log('Incoming call:', data);
      
      if (data.offer && data.callerId && data.callerId.toLowerCase() !== currentUser.walletAddress.toLowerCase()) {
        toast('Incoming call...', { icon: '📞' });
        
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
      }
    });

    // Handle call answers (for outgoing calls - caller receives this)
    const unsubscribeAnswer = webSocketService.on('call:answer', (data: any) => {
      console.log('Call answer received in MainLayout:', data);
      const { activeCall: currentActiveCall } = useAppStore.getState();
      
      if (data.answer && currentActiveCall && data.callId === currentActiveCall.id) {
        console.log('Processing answer signal for call:', data.callId);
        console.log('Current call status BEFORE update:', currentActiveCall.status);
        
        webRTCService.processSignal(currentActiveCall.id, data.answer);
        
        // Update call status to active
        const updatedCall = { ...currentActiveCall, status: 'active' as const };
        console.log('Updating call status to active:', updatedCall);
        setActiveCall(updatedCall);
        
        // Verify it was updated
        setTimeout(() => {
          const { activeCall: checkCall } = useAppStore.getState();
          console.log('Call status AFTER update:', checkCall?.status);
        }, 100);
        
        toast.success('Call connected!');
      } else {
        console.log('NOT processing answer:', {
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
      console.log('📥 ICE candidate received:', { from: data.from, callId: data.callId, hasCandidate: !!data.candidate });
      
      // Determine which call this ICE candidate belongs to
      const targetCallId = data.callId || currentActiveCall?.id || currentIncomingCall?.id;
      
      if (targetCallId && data.candidate) {
        console.log('📥 Adding ICE candidate to call:', targetCallId);
        webRTCService.addIceCandidate(targetCallId, data.candidate);
      } else {
        console.warn('⚠️ Could not process ICE candidate - no matching call');
      }
    });

    // Handle remote stream - this means connection is established
    const unsubscribeStream = webRTCService.onStream((stream, callId) => {
      console.log('MainLayout: Remote stream received for call:', callId);
      const { activeCall: currentActiveCall } = useAppStore.getState();
      console.log('MainLayout: Current activeCall:', currentActiveCall?.id, 'status:', currentActiveCall?.status);
      
      if (currentActiveCall && currentActiveCall.id === callId) {
        console.log('MainLayout: Call IDs match, updating status to ACTIVE');
        const updatedCall = { ...currentActiveCall, status: 'active' as const };
        setActiveCall(updatedCall);
        toast.success('🎉 Call connected!');
        
        // Verify update
        setTimeout(() => {
          const { activeCall: checkCall } = useAppStore.getState();
          console.log('MainLayout: Verified status after update:', checkCall?.status);
        }, 100);
      } else {
        console.log('MainLayout: Call IDs do not match or no active call');
      }
    });

    // Monitor connection state for debugging
    const unsubscribeConnectionState = webRTCService.onConnectionState((state, callId) => {
      console.log(`🔗 Connection state for ${callId}: ${state}`);
      
      if (state === 'failed') {
        toast.error('Connection failed. Try checking your network or TURN server settings.', { duration: 5000 });
      } else if (state === 'disconnected') {
        toast.error('Connection lost. Attempting to reconnect...', { duration: 3000 });
      }
    });

    // Listen for call:ended events
    const handleCallEnded = webSocketService.on('call:ended', (data: any) => {
      console.log('Call ended event:', data);
      toast.error('Call ended');
      webRTCService.cleanup();
      setActiveCall(null);
      setIncomingCall(null);
      setCallModalOpen(false);
    });

    // Listen for call:unavailable events
    const handleUnavailable = webSocketService.on('call:unavailable', (data: any) => {
      toast.error(data.reason || 'User unavailable');
      webRTCService.cleanup();
      setActiveCall(null);
      setCallModalOpen(false);
    });

    return () => {
      unsubscribeIncoming();
      unsubscribeAnswer();
      unsubscribeIce();
      unsubscribeStream();
      unsubscribeConnectionState();
      handleCallEnded();
      handleUnavailable();
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
      <IncomingCallModal />
    </div>
  );
}
