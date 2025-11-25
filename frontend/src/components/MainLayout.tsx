import React, { useEffect } from 'react';
import { useAppStore } from '@/store';
import { webSocketService } from '@/lib/websocket';
import { webRTCService } from '@/lib/webrtc';
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
  } = useAppStore();

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
      const { activeCall: currentActiveCall } = useAppStore.getState();
      console.log('ICE candidate received:', data);
      if (currentActiveCall && data.candidate) {
        // The candidate comes as data.candidate from the backend
        webRTCService.addIceCandidate(currentActiveCall.id, data.candidate);
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
        toast.success('🎉 Call active! Audio should be working now.');
        
        // Verify update
        setTimeout(() => {
          const { activeCall: checkCall } = useAppStore.getState();
          console.log('MainLayout: Verified status after update:', checkCall?.status);
        }, 100);
      } else {
        console.log('MainLayout: Call IDs do not match or no active call');
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
    <div className="flex h-screen bg-gray-50">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#363636',
            color: '#fff',
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
