import React, { useEffect, useRef } from 'react';
import { useAppStore } from '@/store';
import { webRTCService } from '@/lib/webrtc';
import { webSocketService } from '@/lib/websocket';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { truncateAddress, getInitials, getAvatarColor } from '@/utils/helpers';
import toast from 'react-hot-toast';

export default function IncomingCallModal() {
  const { incomingCall, setIncomingCall, setActiveCall, setCallModalOpen } = useAppStore();
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

  const handleAccept = async () => {
    // Stop ringtone
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current = null;
    }

    try {
      toast.loading('Connecting...', { id: 'call-accept' });
      
      const audioOnly = incomingCall.type === 'audio';
      
      // Initialize local media
      const stream = await webRTCService.initializeLocalStream(audioOnly);
      
      // Check if microphone is muted at system level
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0 && audioTracks[0].muted) {
        toast.dismiss('call-accept');
        toast.error('🎤 Your microphone is muted in system settings! Please unmute it and try again.', { duration: 5000 });
        webRTCService.stopLocalStream();
        return;
      }

      // Get the stored offer signal
      const offerJson = sessionStorage.getItem('incomingCallOffer');
      const offer = offerJson ? JSON.parse(offerJson) : null;

      // Create answer peer connection
      const peer = webRTCService.answerCall(
        incomingCall.id,
        audioOnly,
        (signal) => {
          // SimplePeer sends both SDP answer and ICE candidates via onSignal
          // SDP answer has type: 'answer', ICE candidates have 'candidate' property
          if (signal.type === 'answer') {
            console.log('Sending answer signal to caller');
            webSocketService.answerCall(incomingCall.id, signal);
          } else if (signal.candidate) {
            // This is an ICE candidate
            console.log('Sending ICE candidate to caller');
            webSocketService.sendIceCandidate(incomingCall.callerId, signal);
          }
        },
        (candidate) => {
          // This callback might not be used with SimplePeer's trickle
          // but keep it for compatibility
          console.log('Sending ICE candidate (onIceCandidate)');
          webSocketService.sendIceCandidate(incomingCall.callerId, candidate);
        }
      );

      // Process the incoming offer
      if (offer) {
        webRTCService.processSignal(incomingCall.id, offer);
        sessionStorage.removeItem('incomingCallOffer');
      }

      // Set active call and open call modal
      setActiveCall({ ...incomingCall, status: 'active' });
      setIncomingCall(null);
      setCallModalOpen(true);
      
      toast.dismiss('call-accept');
      toast.success('Connected!');
    } catch (error: any) {
      toast.dismiss('call-accept');
      console.error('Error accepting call:', error);
      toast.error(error.message || 'Failed to connect. Check camera/microphone permissions.');
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
      webSocketService.endCall(incomingCall.id);
    }
    
    sessionStorage.removeItem('incomingCallOffer');
    setIncomingCall(null);
  };

  const isVideoCall = incomingCall.type === 'video';

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full mx-4 shadow-2xl">
        <div className="text-center">
          {/* Caller avatar with animation */}
          <div className="relative inline-block mb-6">
            <div className={`w-28 h-28 rounded-full ${getAvatarColor(incomingCall.callerId)} flex items-center justify-center text-white text-3xl font-semibold shadow-lg`}>
              {getInitials(incomingCall.callerId)}
            </div>
            {/* Animated ring */}
            <div className="absolute inset-0 rounded-full border-4 border-primary-500 animate-ping opacity-30" />
          </div>
          
          <h2 className="text-2xl font-bold text-gray-900 mb-1">
            Incoming {isVideoCall ? 'Video' : 'Voice'} Call
          </h2>
          
          <p className="text-gray-600 mb-8">
            {truncateAddress(incomingCall.callerId)}
          </p>

          {/* Action buttons */}
          <div className="flex justify-center gap-8">
            <div className="text-center">
              <button
                onClick={handleReject}
                className="p-5 bg-red-500 hover:bg-red-600 rounded-full transition-all duration-200 transform hover:scale-105 shadow-lg"
              >
                <PhoneOff size={28} className="text-white" />
              </button>
              <p className="text-sm text-gray-500 mt-2">Decline</p>
            </div>
            
            <div className="text-center">
              <button
                onClick={handleAccept}
                className="p-5 bg-green-500 hover:bg-green-600 rounded-full transition-all duration-200 transform hover:scale-105 shadow-lg animate-pulse"
              >
                {isVideoCall ? (
                  <Video size={28} className="text-white" />
                ) : (
                  <Phone size={28} className="text-white" />
                )}
              </button>
              <p className="text-sm text-gray-500 mt-2">Accept</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
