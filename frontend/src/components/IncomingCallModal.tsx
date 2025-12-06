import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store';
import { webRTCService } from '@/lib/webrtc';
import { webSocketService } from '@/lib/websocket';
import { isNative, platform } from '@/lib/mediaPermissions';
import { initCallAudio } from '@/lib/audioRouting';
import { Phone, PhoneOff, Video, Users } from 'lucide-react';
import { truncateAddress, getInitials, getAvatarColor } from '@/utils/helpers';
import { resolveProfile, type BlockStarProfile } from '@/lib/profileResolver';
import toast from 'react-hot-toast';

export default function IncomingCallModal() {
  const { incomingCall, setIncomingCall, setActiveCall, setCallModalOpen, currentUser } = useAppStore();
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const [callerProfile, setCallerProfile] = useState<BlockStarProfile | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

  // Load caller profile when incoming call arrives
  useEffect(() => {
    if (!incomingCall?.callerId) return;

    const loadCallerProfile = async () => {
      try {
        console.log('📞 Loading caller profile for:', incomingCall.callerId);
        
        // First check if callerName was passed with the call
        if ((incomingCall as any).callerName) {
          console.log('📞 Using callerName from call data:', (incomingCall as any).callerName);
          const profile = await resolveProfile((incomingCall as any).callerName);
          if (profile) {
            console.log('✅ Resolved caller profile:', profile.username, profile.avatar);
            setCallerProfile(profile);
            return;
          }
        }

        // Try to fetch from backend API
        const response = await fetch(`${API_URL}/api/profile/${incomingCall.callerId.toLowerCase()}`);
        if (response.ok) {
          const data = await response.json();
          console.log('📞 Caller profile API response:', data);
          
          if (data.success && data.profile?.nftName) {
            const profile = await resolveProfile(data.profile.nftName);
            if (profile) {
              console.log('✅ Resolved caller profile:', profile.username, profile.avatar);
              setCallerProfile(profile);
              return;
            }
          }
        }

        console.log('⚠️ Could not resolve caller profile');
      } catch (error) {
        console.error('Error loading caller profile:', error);
      }
    };

    loadCallerProfile();
    setAvatarFailed(false);
  }, [incomingCall?.callerId, API_URL]);

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
      
      // Initialize call audio routing FIRST (earpiece mode)
      console.log('📞 Initializing call audio routing...');
      try {
        await initCallAudio();
        console.log('✅ Call audio initialized - using earpiece');
      } catch (audioErr) {
        console.warn('⚠️ Could not initialize call audio routing:', audioErr);
      }
      
      const audioOnly = incomingCall.type === 'audio';
      
      console.log('========================================');
      console.log('📞 ACCEPTING CALL');
      console.log('   Call ID:', incomingCall.id);
      console.log('   Call type:', incomingCall.type);
      console.log('   Caller:', incomingCall.callerId);
      console.log('   Caller name:', callerProfile?.username || 'unknown');
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

        // Set active call with group properties and caller info
        setActiveCall({ 
          ...incomingCall, 
          status: 'active',
          isGroupCall: true,
          callerProfile: callerProfile,
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

        // Set active call with caller profile info
        setActiveCall({ 
          ...incomingCall, 
          status: 'active',
          callerProfile: callerProfile,
        });
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
    setCallerProfile(null);
    setIncomingCall(null);
  };

  const isVideoCall = incomingCall.type === 'video';
  
  // Get display name - prefer @username over wallet address
  const displayName = isGroupCall 
    ? ((incomingCall as any).groupName || 'Group Call')
    : callerProfile?.username 
      ? `@${callerProfile.username}`
      : truncateAddress(incomingCall.callerId);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-card border border-midnight rounded-3xl p-8 max-w-sm w-full mx-4 shadow-2xl">
        <div className="text-center">
          {/* Caller avatar with animation */}
          <div className="relative inline-block mb-6">
            {callerProfile?.avatar && !avatarFailed ? (
              <img
                src={callerProfile.avatar}
                alt=""
                className="w-28 h-28 rounded-full object-cover shadow-glow-lg ring-4 ring-primary-500"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <div className={`w-28 h-28 rounded-full flex items-center justify-center text-white text-3xl font-semibold shadow-glow-lg ${
                isGroupCall 
                  ? 'bg-gradient-to-br from-purple-500 to-pink-500' 
                  : getAvatarColor(callerProfile?.username || incomingCall.callerId)
              }`}>
                {isGroupCall ? <Users size={48} /> : getInitials(callerProfile?.username || incomingCall.callerId)}
              </div>
            )}
            {/* Animated ring */}
            <div className="absolute inset-0 rounded-full border-4 border-primary-500 animate-ping opacity-30" />
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-1">
            Incoming {isGroupCall ? 'Group ' : ''}{isVideoCall ? 'Video' : 'Voice'} Call
          </h2>
          
          {/* Display @username or wallet address */}
          <p className="text-secondary text-lg mb-1">
            {displayName}
          </p>
          
          {/* Show wallet address as secondary info if we have a username */}
          {!isGroupCall && callerProfile?.username && (
            <p className="text-xs text-muted mb-6">
              {truncateAddress(incomingCall.callerId)}
            </p>
          )}
          
          {isGroupCall && (
            <p className="text-xs text-muted mb-6">
              From: {callerProfile?.username ? `@${callerProfile.username}` : truncateAddress(incomingCall.callerId)}
            </p>
          )}
          
          {!isGroupCall && !callerProfile?.username && <div className="mb-8" />}

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
