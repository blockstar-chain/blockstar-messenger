// frontend/src/components/IncomingCallModal.tsx
// Fixed version - connects to store and handles WebRTC answer flow

import React, { useEffect, useState, useCallback } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { useAppStore } from '@/store';
import { webRTCService } from '@/lib/webrtc';
import { webSocketService } from '@/lib/websocket';
import { getAvatarColor, getInitials, truncateAddress } from '@/utils/helpers';
import { profileResolverService, resolveProfilesByWallets } from '@/lib/profileResolver';
import toast from 'react-hot-toast';

export default function IncomingCallModal() {
  const { 
    incomingCall, 
    setIncomingCall, 
    setActiveCall, 
    setCallModalOpen,
    currentUser 
  } = useAppStore();
  
  const [pulseRing, setPulseRing] = useState(true);
  const [callerProfile, setCallerProfile] = useState<{ name?: string; avatar?: string } | null>(null);
  const [isAnswering, setIsAnswering] = useState(false);

  // Fetch caller profile
  useEffect(() => {
    if (!incomingCall?.callerId) {
      setCallerProfile(null);
      return;
    }

    const fetchProfile = async () => {
      try {
        const profile = await resolveProfilesByWallets(incomingCall.callerId);
        if (profile) {
          setCallerProfile({
            name: profile.username,
            avatar: profile.avatar
          });
        }
      } catch (error) {
        console.error('Error fetching caller profile:', error);
      }
    };

    fetchProfile();

    // Also check sessionStorage for caller info (from push notification)
    try {
      const storedInfo = sessionStorage.getItem('incomingCallInfo');
      if (storedInfo) {
        const info = JSON.parse(storedInfo);
        if (info.callerName || info.callerAvatar) {
          setCallerProfile(prev => ({
            name: info.callerName || prev?.name,
            avatar: info.callerAvatar || prev?.avatar
          }));
        }
      }
    } catch (e) {
      // Ignore
    }
  }, [incomingCall?.callerId]);

  // Pulse animation
  useEffect(() => {
    if (!incomingCall) return;
    const interval = setInterval(() => {
      setPulseRing(prev => !prev);
    }, 1000);
    return () => clearInterval(interval);
  }, [incomingCall]);

  // Play ringtone
  useEffect(() => {
    if (!incomingCall) return;

    let audio: HTMLAudioElement | null = null;
    
    try {
      audio = new Audio('/sounds/incoming.mp3');
      audio.loop = true;
      audio.play().catch(e => console.warn('Could not play ringtone:', e));
    } catch (e) {
      console.warn('Ringtone not available');
    }

    return () => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    };
  }, [incomingCall]);

  // Handle answer
  const handleAnswer = useCallback(async () => {
    if (!incomingCall || !currentUser || isAnswering) return;
    
    setIsAnswering(true);
    console.log('📞 Answering call:', incomingCall.id);

    try {
      // 1. Get the stored offer from sessionStorage
      const storedOffer = sessionStorage.getItem('incomingCallOffer');
      if (!storedOffer) {
        throw new Error('No call offer found');
      }
      const offer = JSON.parse(storedOffer);
      console.log('📞 Retrieved offer:', { type: offer.type, hasSdp: !!offer.sdp });

      // 2. Initialize local media stream
      const isVideoCall = incomingCall.type === 'video';
      console.log('📞 Initializing local stream, video:', isVideoCall);
      await webRTCService.initializeLocalStream(!isVideoCall);

      // 3. Create the answering peer connection
      const peer = webRTCService.answerCall(
        incomingCall.id,
        !isVideoCall,
        // onSignal - send answer back to caller
        (signal) => {
          console.log('📤 SIGNAL from answerer:', signal.type || 'candidate');
          
          if (signal.type === 'answer') {
            console.log('📤 Sending ANSWER to caller');
            webSocketService.answerCall(incomingCall.id, signal);
          } else if (signal.candidate) {
            // Send ICE candidates
            console.log('📤 Sending ICE candidate to caller');
            webSocketService.sendIceCandidate(
              incomingCall.callerId,
              signal,
              incomingCall.id
            );
          }
        }
      );

      // 4. Process the offer to generate answer
      console.log('📞 Processing offer signal...');
      webRTCService.processSignal(incomingCall.id, offer);

      // 5. Transition to active call
      setActiveCall({
        id: incomingCall.id,
        recipientId: incomingCall.callerId,
        callerId: currentUser.walletAddress,
        type: incomingCall.type,
        status: 'active',
        startTime: Date.now(),
      });

      // 6. Open call modal and clear incoming call
      setCallModalOpen(true);
      setIncomingCall(null);
      
      // Clean up stored data
      sessionStorage.removeItem('incomingCallOffer');
      sessionStorage.removeItem('incomingCallInfo');

      console.log('✅ Call answered successfully');

    } catch (error: any) {
      console.error('❌ Error answering call:', error);
      toast.error('Failed to answer call: ' + error.message);
      
      // Cleanup on error
      webRTCService.cleanup();
      setIncomingCall(null);
      sessionStorage.removeItem('incomingCallOffer');
      sessionStorage.removeItem('incomingCallInfo');
    } finally {
      setIsAnswering(false);
    }
  }, [incomingCall, currentUser, isAnswering, setActiveCall, setCallModalOpen, setIncomingCall]);

  // Handle decline
  const handleDecline = useCallback(() => {
    if (!incomingCall) return;
    
    console.log('📞 Declining call:', incomingCall.id);
    
    // Notify caller that call was declined
    webSocketService.endCall(incomingCall.id);
    
    // Report this as a declined call for the chat history
    webSocketService.reportMissedCall(
      incomingCall.id,
      incomingCall.callerId,
      currentUser?.walletAddress || '',
      incomingCall.type,
      'declined',
      undefined // callerName - backend will look it up
    );
    
    // Clean up
    setIncomingCall(null);
    sessionStorage.removeItem('incomingCallOffer');
    sessionStorage.removeItem('incomingCallInfo');
    
    toast('Call declined', { icon: '📵' });
  }, [incomingCall, currentUser?.walletAddress, setIncomingCall]);

  // Don't render if no incoming call
  if (!incomingCall) return null;

  const displayName = callerProfile?.name || truncateAddress(incomingCall.callerId);
  const avatarBg = getAvatarColor(incomingCall.callerId);
  const callerAvatar = callerProfile?.avatar;
  const callType = incomingCall.type || 'audio';

  return (
    <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col items-center justify-center p-4">
      {/* Background animation */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] sm:w-[600px] sm:h-[600px] bg-gradient-to-r from-primary-500/20 to-purple-500/20 rounded-full blur-3xl animate-pulse" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center w-full max-w-sm">
        {/* Call type indicator */}
        <div className="flex items-center gap-2 mb-4 sm:mb-6 px-3 sm:px-4 py-1.5 sm:py-2 bg-white/10 rounded-full">
          {callType === 'video' ? (
            <Video size={16} className="text-primary-400 sm:w-[18px] sm:h-[18px]" />
          ) : (
            <Phone size={16} className="text-primary-400 sm:w-[18px] sm:h-[18px]" />
          )}
          <span className="text-white/80 text-xs sm:text-sm">
            Incoming {callType === 'video' ? 'Video' : 'Voice'} Call
          </span>
        </div>

        {/* Avatar with pulse ring */}
        <div className="relative mb-4 sm:mb-6">
          {/* Pulse rings */}
          <div 
            className="absolute inset-0 rounded-full border-2 border-primary-500/50 animate-ping" 
            style={{ animationDuration: '1.5s' }} 
          />
          <div 
            className={`absolute -inset-2 sm:-inset-3 rounded-full border border-primary-500/30 ${pulseRing ? 'scale-110 opacity-0' : 'scale-100 opacity-100'} transition-all duration-1000`} 
          />
          <div 
            className={`absolute -inset-4 sm:-inset-6 rounded-full border border-primary-500/20 ${!pulseRing ? 'scale-110 opacity-0' : 'scale-100 opacity-100'} transition-all duration-1000`} 
          />
          
          {/* Avatar */}
          <div className={`w-20 h-20 sm:w-28 sm:h-28 rounded-full flex items-center justify-center overflow-hidden border-4 border-primary-500/50 ${avatarBg}`}>
            {callerAvatar ? (
              <img 
                src={callerAvatar} 
                alt={displayName} 
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-2xl sm:text-4xl font-bold text-white">
                {getInitials(displayName)}
              </span>
            )}
          </div>
        </div>

        {/* Caller info */}
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-1 sm:mb-2 text-center">
          {displayName}
        </h2>
        {callerProfile?.name && incomingCall.callerId && (
          <p className="text-gray-400 text-xs sm:text-sm mb-6 sm:mb-8">
            {truncateAddress(incomingCall.callerId)}
          </p>
        )}
        {!callerProfile?.name && (
          <p className="text-gray-400 text-xs sm:text-sm mb-6 sm:mb-8">is calling you...</p>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-8 sm:gap-12">
          {/* Decline button */}
          <div className="flex flex-col items-center gap-1.5 sm:gap-2">
            <button
              onClick={handleDecline}
              disabled={isAnswering}
              className="w-14 h-14 sm:w-16 sm:h-16 bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-full flex items-center justify-center transition-all hover:scale-110 shadow-lg shadow-red-500/30"
            >
              <PhoneOff size={24} className="text-white sm:w-[28px] sm:h-[28px]" />
            </button>
            <span className="text-gray-400 text-xs sm:text-sm">Decline</span>
          </div>

          {/* Answer button */}
          <div className="flex flex-col items-center gap-1.5 sm:gap-2">
            <button
              onClick={handleAnswer}
              disabled={isAnswering}
              className="w-14 h-14 sm:w-16 sm:h-16 bg-green-500 hover:bg-green-600 disabled:opacity-50 rounded-full flex items-center justify-center transition-all hover:scale-110 shadow-lg shadow-green-500/30 animate-bounce"
              style={{ animationDuration: '1s' }}
            >
              {isAnswering ? (
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : callType === 'video' ? (
                <Video size={24} className="text-white sm:w-[28px] sm:h-[28px]" />
              ) : (
                <Phone size={24} className="text-white sm:w-[28px] sm:h-[28px]" />
              )}
            </button>
            <span className="text-gray-400 text-xs sm:text-sm">
              {isAnswering ? 'Connecting...' : 'Answer'}
            </span>
          </div>
        </div>

        {/* Hint */}
        <p className="mt-8 sm:mt-12 text-gray-500 text-xs text-center">
          Tap to answer or decline
        </p>
      </div>
    </div>
  );
}
