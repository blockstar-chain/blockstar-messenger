import React, { useEffect, useRef } from 'react';
import { useAppStore } from '@/store';
import { webRTCService } from '@/lib/webrtc';
import { webSocketService } from '@/lib/websocket';
import { isNative, platform } from '@/lib/mediaPermissions';
import { Phone, PhoneOff, Video, Users } from 'lucide-react';
import { truncateAddress, getInitials, getAvatarColor } from '@/utils/helpers';
import toast from 'react-hot-toast';

export default function IncomingCallModal() {
  const { incomingCall, setIncomingCall, setActiveCall, setCallModalOpen, currentUser } = useAppStore();
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  // Play ringtone
  useEffect(() => {
    if (incomingCall) {
      // Create and play ringtone
      ringtoneRef.current = new Audio('/sounds/ringtone.mp3');
      ringtoneRef.current.loop = true;
      ringtoneRef.current.volume = 0.5;
      ringtoneRef.current.play().catch(() => {
        // Autoplay might be blocked
        console.log('Ringtone autoplay blocked');
      });

      // Auto-reject after 30 seconds
      const timeout = setTimeout(() => {
        handleReject();
        toast.error('Call missed');
      }, 30000);

      return () => {
        clearTimeout(timeout);
        if (ringtoneRef.current) {
          ringtoneRef.current.pause();
          ringtoneRef.current = null;
        }
      };
    }
  }, [incomingCall]);

  if (!incomingCall) return null;

  const isGroupCall = incomingCall.isGroupCall || 
    (Array.isArray(incomingCall.participants) && incomingCall.participants.length > 2);

  const handleAccept = async () => {
    // Stop ringtone
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current = null;
    }

    try {
      toast.loading('Connecting...', { id: 'call-accept' });
      
      const audioOnly = incomingCall.type === 'audio';
      
      console.log('========================================');
      console.log('📞 ACCEPTING CALL');
      console.log('   Call ID:', incomingCall.id);
      console.log('   Call type:', incomingCall.type);
      console.log('   Caller:', incomingCall.callerId);
      console.log('   Is group call:', isGroupCall);
      console.log('========================================');
      
      // Initialize local media
      const stream = await webRTCService.initializeLocalStream(audioOnly);
      
      // Check if microphone is muted at system level
      const audioTracks = stream.getAudioTracks();
      console.log('📞 Local audio tracks:', audioTracks.length);
      audioTracks.forEach((t, i) => {
        console.log('   Track ' + i + ':', { enabled: t.enabled, muted: t.muted, readyState: t.readyState });
      });
      
      if (audioTracks.length > 0 && audioTracks[0].muted) {
        toast.dismiss('call-accept');
        toast.error('🎤 Your microphone is muted in system settings!', { duration: 5000 });
        webRTCService.stopLocalStream();
        return;
      }

      // Get the stored offer signal
      const offerJson = sessionStorage.getItem('incomingCallOffer');
      const offer = offerJson ? JSON.parse(offerJson) : null;
      
      console.log('📞 Retrieved offer from session:', !!offer);
      if (offer) {
        console.log('   Offer type:', offer.type);
        console.log('   Offer has SDP:', !!offer.sdp);
      }

      if (isGroupCall) {
        // GROUP CALL ACCEPT
        const peerId = (incomingCall as any).peerId || `${incomingCall.id}-${currentUser?.walletAddress?.toLowerCase()}`;
        
        const peer = webRTCService.answerCall(
          peerId,
          audioOnly,
          (signal) => {
            if (signal.type === 'answer') {
              console.log('📤 Sending group call ANSWER to caller');
              webSocketService.emit('group:call:answer', {
                callId: incomingCall.id,
                answer: signal,
                peerId,
                toAddress: incomingCall.callerId,
              });
            } else if (signal.candidate || signal.type === 'candidate') {
              console.log('📤 Sending group call ICE candidate');
              webSocketService.emit('group:call:ice-candidate', {
                recipientAddress: incomingCall.callerId,
                candidate: signal,
                callId: incomingCall.id,
                peerId,
              });
            }
          },
          (candidate) => {
            webSocketService.emit('group:call:ice-candidate', {
              recipientAddress: incomingCall.callerId,
              candidate,
              callId: incomingCall.id,
              peerId,
            });
          }
        );

        // Process the incoming offer
        if (offer) {
          console.log('📞 Processing incoming group call offer...');
          webRTCService.processSignal(peerId, offer);
          sessionStorage.removeItem('incomingCallOffer');
        }

        // Set active call with group properties
        setActiveCall({ 
          ...incomingCall, 
          status: 'active',
          isGroupCall: true,
        });
      } else {
        // DIRECT CALL ACCEPT
        console.log('📞 Creating answer peer for direct call...');
        
        const peer = webRTCService.answerCall(
          incomingCall.id,
          audioOnly,
          (signal) => {
            if (signal.type === 'answer') {
              console.log('========================================');
              console.log('📤 Sending ANSWER signal to caller');
              console.log('   Call ID:', incomingCall.id);
              console.log('   Caller:', incomingCall.callerId);
              console.log('   Answer type:', signal.type);
              console.log('========================================');
              webSocketService.answerCall(incomingCall.id, signal);
            } else if (signal.candidate || signal.type === 'candidate') {
              console.log('📤 Sending ICE candidate to caller:', incomingCall.callerId);
              webSocketService.sendIceCandidate(incomingCall.callerId, signal, incomingCall.id);
            } else {
              console.log('📤 Sending other signal:', signal.type);
              webSocketService.sendIceCandidate(incomingCall.callerId, signal, incomingCall.id);
            }
          },
          (candidate) => {
            console.log('📤 Sending ICE candidate (separate callback) to:', incomingCall.callerId);
            webSocketService.sendIceCandidate(incomingCall.callerId, candidate, incomingCall.id);
          }
        );

        // Process the incoming offer
        if (offer) {
          console.log('📞 Processing incoming offer...');
          webRTCService.processSignal(incomingCall.id, offer);
          sessionStorage.removeItem('incomingCallOffer');
        } else {
          console.error('❌ No offer found in session storage!');
        }

        // Set active call
        setActiveCall({ ...incomingCall, status: 'active' });
      }
      
      setIncomingCall(null);
      setCallModalOpen(true);
      
      toast.dismiss('call-accept');
      toast.success('Connected!');
    } catch (error: any) {
      toast.dismiss('call-accept');
      console.error('Error accepting call:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      
      // Show user-friendly error message based on platform
      const errorMessage = error.message || 'Failed to connect';
      
      if (errorMessage.toLowerCase().includes('permission denied') || 
          errorMessage.toLowerCase().includes('permission') ||
          error.name === 'NotAllowedError') {
        
        if (isNative) {
          if (platform === 'android') {
            toast.error(
              '🎤 Microphone permission required!\n\nGo to Settings > Apps > BlockStar > Permissions and enable Microphone.',
              { duration: 8000 }
            );
          } else if (platform === 'ios') {
            toast.error(
              '🎤 Microphone permission required!\n\nGo to Settings > BlockStar and enable Microphone.',
              { duration: 8000 }
            );
          } else {
            toast.error('🎤 ' + errorMessage, { duration: 6000 });
          }
        } else {
          toast.error('🎤 Please allow microphone access in your browser settings', { duration: 5000 });
        }
      } else {
        toast.error(errorMessage, { duration: 5000 });
      }
      
      handleReject();
    }
  };

  const handleReject = () => {
    // Stop ringtone
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current = null;
    }

    if (incomingCall) {
      if (isGroupCall) {
        webSocketService.emit('group:call:leave', {
          callId: incomingCall.id,
          groupId: incomingCall.id.split('-')[0],
        });
      } else {
        webSocketService.endCall(incomingCall.id);
      }
    }
    
    sessionStorage.removeItem('incomingCallOffer');
    setIncomingCall(null);
  };

  const isVideoCall = incomingCall.type === 'video';
  const displayName = isGroupCall 
    ? ((incomingCall as any).groupName || 'Group Call')
    : truncateAddress(incomingCall.callerId);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-card border border-midnight rounded-3xl p-8 max-w-sm w-full mx-4 shadow-2xl">
        <div className="text-center">
          {/* Caller avatar with animation */}
          <div className="relative inline-block mb-6">
            <div className={`w-28 h-28 rounded-full flex items-center justify-center text-white text-3xl font-semibold shadow-glow-lg ${
              isGroupCall 
                ? 'bg-gradient-to-br from-purple-500 to-pink-500' 
                : 'bg-gradient-to-br from-primary-500 to-cyan-500'
            }`}>
              {isGroupCall ? <Users size={48} /> : getInitials(incomingCall.callerId)}
            </div>
            {/* Animated ring */}
            <div className="absolute inset-0 rounded-full border-4 border-primary-500 animate-ping opacity-30" />
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-1">
            Incoming {isGroupCall ? 'Group ' : ''}{isVideoCall ? 'Video' : 'Voice'} Call
          </h2>
          
          <p className="text-secondary mb-2">
            {displayName}
          </p>
          
          {isGroupCall && (
            <p className="text-xs text-muted mb-6">
              From: {truncateAddress(incomingCall.callerId)}
            </p>
          )}
          
          {!isGroupCall && <div className="mb-8" />}

          {/* Action buttons */}
          <div className="flex justify-center gap-8">
            <div className="text-center">
              <button
                onClick={handleReject}
                className="p-5 bg-danger-500 hover:bg-danger-600 rounded-full transition-all duration-200 transform hover:scale-105 shadow-lg"
              >
                <PhoneOff size={28} className="text-white" />
              </button>
              <p className="text-sm text-muted mt-2">Decline</p>
            </div>
            
            <div className="text-center">
              <button
                onClick={handleAccept}
                className="p-5 bg-success-500 hover:bg-success-600 rounded-full transition-all duration-200 transform hover:scale-105 shadow-glow-green animate-pulse"
              >
                {isVideoCall ? (
                  <Video size={28} className="text-white" />
                ) : (
                  <Phone size={28} className="text-white" />
                )}
              </button>
              <p className="text-sm text-muted mt-2">Accept</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
