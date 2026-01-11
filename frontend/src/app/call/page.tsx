// frontend/src/app/call/page.tsx
// Mobile incoming call page - stays on page during active call (no redirect)
'use client';

import React, { useEffect, useState, useCallback, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Phone, PhoneOff, Video, Wifi, WifiOff, Mic, MicOff, Volume2 } from 'lucide-react';
import { useAppStore } from '@/store';
import { webSocketService } from '@/lib/websocket';
import { getAvatarColor, getInitials, truncateAddress } from '@/utils/helpers';
import toast from 'react-hot-toast';
import { API_BASE } from '@/lib/profileResolver';

export default function MobileCallPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <MobileCallContent />
    </Suspense>
  );
}

function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <div className="text-white text-center">
        <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p>Loading...</p>
      </div>
    </div>
  );
}

function MobileCallContent() {
  const searchParams = useSearchParams();
  const { currentUser, setCurrentUser, setActiveCall } = useAppStore();

  // Call states
  const [callState, setCallState] = useState<'incoming' | 'connecting' | 'active' | 'ended'>('incoming');
  const [callDuration, setCallDuration] = useState(0);
  
  // UI states
  const [callerProfile, setCallerProfile] = useState<{ name?: string; avatar?: string } | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('');
  
  // Call data
  const [callData, setCallData] = useState<{
    id: string;
    callerId: string;
    callerName?: string;
    type: 'audio' | 'video';
    authToken?: string;
  } | null>(null);
  
  // Loading/error states
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  
  // Refs
  const ringtoneRef = useRef<HTMLAudioElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const callStartTimeRef = useRef<number>(0);
  const answerInProgressRef = useRef(false);
  const iceCandidateHandlerRef = useRef<((data: any) => void) | null>(null);

  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  
  useEffect(() => {
    const callId = searchParams.get('callId');
    const callerId = searchParams.get('callerId');
    const callerName = searchParams.get('callerName');
    const callType = searchParams.get('callType') || 'audio';
    const authToken = searchParams.get('token');

    console.log('📱 Mobile call page loaded:', { callId, callerId, hasToken: !!authToken });

    if (!callId || !callerId) {
      setError('Invalid call parameters');
      setIsLoading(false);
      return;
    }

    setCallData({
      id: callId,
      callerId: callerId.toLowerCase(),
      callerName: callerName || undefined,
      type: callType as 'audio' | 'video',
      authToken: authToken || undefined,
    });

    // Authenticate
    if (authToken) {
      verifyToken(authToken, callId);
    } else if (currentUser?.walletAddress) {
      setIsAuthenticated(true);
      connectWebSocket(currentUser.walletAddress);
      setIsLoading(false);
    } else {
      setError('Please open the app to answer this call');
      setIsLoading(false);
    }

    // Fetch caller profile
    fetchCallerProfile(callerId, callerName);

    // Cleanup on unmount
    return () => {
      stopRingtone();
      cleanupCall();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verifyToken = async (token: string, callId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/calls/verify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Invalid token');
      }

      if (data.user) {
        setCurrentUser({ walletAddress: data.user.walletAddress, username: data.user.username });
      }

      setIsAuthenticated(true);
      connectWebSocket(data.user?.walletAddress || data.recipientWallet);
      setIsLoading(false);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
      setIsLoading(false);
    }
  };

  const connectWebSocket = (walletAddress: string) => {
    webSocketService.connect(walletAddress);
    
    const checkInterval = setInterval(() => {
      if (webSocketService.isConnected()) {
        setWsConnected(true);
        clearInterval(checkInterval);
      }
    }, 500);

    setTimeout(() => clearInterval(checkInterval), 10000);
  };

  const fetchCallerProfile = async (callerId: string, callerName?: string | null) => {
    if (callerName) setCallerProfile({ name: callerName });
    
    try {
      const response = await fetch(`${API_BASE}/api/keys/${callerId}`);
      const data = await response.json();
      if (data.success && data.username) {
        setCallerProfile({ name: data.username, avatar: data.avatar });
      }
    } catch (err) {}
  };

  // ═══════════════════════════════════════════════════════════════
  // RINGTONE
  // ═══════════════════════════════════════════════════════════════

  useEffect(() => {
    if (callState !== 'incoming' || isLoading || error) return;

    const audio = ringtoneRef.current;
    if (audio) {
      audio.loop = true;
      audio.play().catch(() => {});
    }

    return () => stopRingtone();
  }, [callState, isLoading, error]);

  const stopRingtone = () => {
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // CALL DURATION TIMER
  // ═══════════════════════════════════════════════════════════════

  useEffect(() => {
    if (callState !== 'active') return;
    
    const interval = setInterval(() => {
      if (callStartTimeRef.current) {
        setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [callState]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ═══════════════════════════════════════════════════════════════
  // ANSWER CALL - Direct RTCPeerConnection (no webRTCService wrapper)
  // ═══════════════════════════════════════════════════════════════

  const handleAnswer = async () => {
    if (!callData || answerInProgressRef.current) return;
    answerInProgressRef.current = true;

    stopRingtone();
    setCallState('connecting');
    console.log('📞 Answering call:', callData.id);

    try {
      // Step 1: Fetch offer from server
      setConnectionStatus('Getting call data...');
      console.log('📞 Step 1: Fetching offer...');
      
      const offerRes = await fetch(
        `${API_BASE}/api/calls/${callData.id}/offer${callData.authToken ? `?token=${callData.authToken}` : ''}`
      );
      
      if (!offerRes.ok) {
        const errData = await offerRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Call not found or expired');
      }
      
      const { offer } = await offerRes.json();
      if (!offer?.sdp) throw new Error('Invalid call data');
      console.log('📞 Got offer:', offer.type);

      // Step 2: Get microphone access
      setConnectionStatus('Accessing microphone...');
      console.log('📞 Step 2: Getting microphone...');
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: callData.type === 'video' 
      });
      localStreamRef.current = stream;
      console.log('📞 Got local stream, tracks:', stream.getTracks().length);

      // Step 3: Create RTCPeerConnection
      setConnectionStatus('Setting up connection...');
      console.log('📞 Step 3: Creating peer connection...');
      
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ]
      });
      peerConnectionRef.current = pc;

      // Add local tracks to connection
      stream.getTracks().forEach(track => {
        console.log('📞 Adding track:', track.kind);
        pc.addTrack(track, stream);
      });

      // Track if we've already transitioned to active (declare early so all handlers can use it)
      let hasConnected = false;
      
      const checkAndTransitionToActive = (source: string) => {
        if (hasConnected) return;
        
        const connState = pc.connectionState;
        const iceState = pc.iceConnectionState;
        
        console.log(`📞 ${source} - Connection: ${connState}, ICE: ${iceState}`);
        
        // Check if connected via either state
        if (connState === 'connected' || iceState === 'connected' || iceState === 'completed') {
          hasConnected = true;
          console.log('✅ Call connected!');
          setCallState('active');
          callStartTimeRef.current = Date.now();
          setConnectionStatus('');
          toast.success('Call connected!');
        } else if (connState === 'failed' || iceState === 'failed') {
          console.log('❌ Connection failed');
          endCall('Connection failed');
        }
      };

      // Handle incoming remote stream - THIS IS A STRONG SIGNAL WE'RE CONNECTED
      pc.ontrack = (event) => {
        console.log('🔊 Remote track received:', event.track.kind);
        if (remoteAudioRef.current && event.streams[0]) {
          remoteAudioRef.current.srcObject = event.streams[0];
          remoteAudioRef.current.play().catch(e => console.warn('Audio play error:', e));
          
          // If we got a remote track, we're definitely connected!
          if (!hasConnected) {
            hasConnected = true;
            console.log('✅ Connected (detected via remote track)');
            setCallState('active');
            callStartTimeRef.current = Date.now();
            setConnectionStatus('');
            toast.success('Call connected!');
          }
        }
      };

      // Handle ICE candidates - send to caller
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('📤 Sending ICE candidate to caller');
          webSocketService.sendIceCandidate(callData.callerId, event.candidate, callData.id);
        }
      };

      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        checkAndTransitionToActive('connectionState');
        
        if (pc.connectionState === 'disconnected') {
          console.log('⚠️ Connection disconnected');
          setTimeout(() => {
            if (pc.connectionState === 'disconnected') {
              endCall('Connection lost');
            }
          }, 5000);
        }
      };

      // IMPORTANT: Also check ICE connection state - this often updates first on mobile!
      pc.oniceconnectionstatechange = () => {
        checkAndTransitionToActive('iceConnectionState');
      };

      // Step 4: Listen for ICE candidates from caller
      console.log('📞 Step 4: Setting up ICE candidate listener...');
      
      iceCandidateHandlerRef.current = (data: any) => {
        if (data.callId === callData.id && data.candidate && peerConnectionRef.current) {
          console.log('📥 Received ICE candidate from caller');
          peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate))
            .catch(e => console.warn('Error adding ICE candidate:', e));
        }
      };
      webSocketService.on('ice-candidate', iceCandidateHandlerRef.current);

      // Step 5: Set remote description (the offer)
      setConnectionStatus('Connecting to caller...');
      console.log('📞 Step 5: Setting remote description...');
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Step 6: Create and set local description (the answer)
      console.log('📞 Step 6: Creating answer...');
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Step 7: Send answer to caller via WebSocket
      console.log('📤 Step 7: Sending answer to caller...');
      webSocketService.answerCall(callData.id, answer);

      // Update store
      setActiveCall({
        id: callData.id,
        recipientId: callData.callerId,
        callerId: currentUser?.walletAddress || '',
        type: callData.type,
        status: 'active',
        startTime: Date.now(),
      });

      console.log('📞 Answer sent, waiting for connection...');
      setConnectionStatus('Establishing connection...');

      // Shorter timeout - if not connected in 10s, force transition
      // (the audio might already be working even if state didn't update)
      setTimeout(() => {
        if (!hasConnected && peerConnectionRef.current) {
          const state = peerConnectionRef.current.connectionState;
          const iceState = peerConnectionRef.current.iceConnectionState;
          console.log(`⚠️ Timeout check - Connection: ${state}, ICE: ${iceState}`);
          
          // If we have any indication of connectivity, show as active
          if (state !== 'failed' && iceState !== 'failed') {
            console.log('📞 Forcing transition to active state');
            hasConnected = true;
            setCallState('active');
            callStartTimeRef.current = Date.now();
            setConnectionStatus('');
          }
        }
      }, 10000);

    } catch (err: any) {
      console.error('❌ Answer error:', err);
      toast.error(err.message || 'Failed to connect');
      cleanupCall();
      setCallState('incoming');
      setConnectionStatus('');
      answerInProgressRef.current = false;
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // DECLINE / END CALL
  // ═══════════════════════════════════════════════════════════════

  const handleDecline = () => {
    if (!callData) return;
    
    stopRingtone();
    console.log('📞 Declining call');
    
    webSocketService.endCall(callData.id);
    
    fetch(`${API_BASE}/api/calls/${callData.id}/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callerId: callData.callerId })
    }).catch(() => {});

    endCall('Call declined');
  };

  const handleEndCall = () => {
    if (!callData) return;
    
    console.log('📞 Ending call');
    webSocketService.endCall(callData.id);
    endCall('Call ended');
  };

  const endCall = useCallback((reason?: string) => {
    cleanupCall();
    setCallState('ended');
    if (reason) setError(reason);
    
    setTimeout(() => {
      window.location.href = '/';
    }, 2000);
  }, []);

  const cleanupCall = () => {
    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('📞 Stopped track:', track.kind);
      });
      localStreamRef.current = null;
    }
    
    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
      console.log('📞 Closed peer connection');
    }

    // Note: Can't easily remove the ICE candidate listener without .off()
    // It will be cleaned up when socket disconnects
  };

  // ═══════════════════════════════════════════════════════════════
  // CALL CONTROLS
  // ═══════════════════════════════════════════════════════════════

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
        console.log('📞 Mic:', track.enabled ? 'ON' : 'OFF');
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleSpeaker = () => {
    setIsSpeaker(!isSpeaker);
    // True speaker toggle requires native mobile code
    // This is just a visual toggle for now
  };

  // ═══════════════════════════════════════════════════════════════
  // CHECK IF CALL IS STILL ACTIVE
  // ═══════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!callData?.id || callState !== 'incoming') return;

    const checkStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/calls/${callData.id}/status`);
        const data = await res.json();
        if (data.success && !data.active) {
          console.log('📞 Call is no longer active');
          stopRingtone();
          setError('Call ended');
          setCallState('ended');
        }
      } catch (err) {}
    };

    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [callData?.id, callState]);

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  // Loading
  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-white text-center">
          <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p>Connecting...</p>
        </div>
      </div>
    );
  }

  // Ended / Error
  if (callState === 'ended' || (error && callState !== 'incoming')) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <PhoneOff className="w-8 h-8 text-red-500" />
          </div>
          <p className="text-white text-lg mb-2">Call Ended</p>
          <p className="text-gray-500 mb-6">{error || 'Returning to app...'}</p>
          <button
            onClick={() => window.location.href = '/'}
            className="px-6 py-3 bg-primary-500 text-white rounded-xl"
          >
            Return to App
          </button>
        </div>
      </div>
    );
  }

  if (!callData) return null;

  const displayName = callerProfile?.name || callData.callerName || truncateAddress(callData.callerId);
  const avatarBg = getAvatarColor(callData.callerId);

  // ═══════════════════════════════════════════════════════════════
  // ACTIVE CALL UI
  // ═══════════════════════════════════════════════════════════════
  if (callState === 'active') {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-gray-900 to-black flex flex-col items-center justify-between py-16 px-4">
        {/* Remote audio */}
        <audio ref={remoteAudioRef} autoPlay playsInline />
        
        {/* Top - Duration */}
        <div className="text-center">
          <p className="text-green-400 text-sm mb-1">● Connected</p>
          <p className="text-white text-3xl font-mono">{formatDuration(callDuration)}</p>
        </div>

        {/* Middle - Avatar */}
        <div className="flex flex-col items-center">
          <div className={`w-32 h-32 rounded-full flex items-center justify-center border-4 border-green-500/50 ${avatarBg}`}>
            {callerProfile?.avatar ? (
              <img src={callerProfile.avatar} alt="" className="w-full h-full rounded-full object-cover" />
            ) : (
              <span className="text-5xl font-bold text-white">{getInitials(displayName)}</span>
            )}
          </div>
          <h2 className="text-2xl font-bold text-white mt-4">{displayName}</h2>
          <p className="text-gray-400 text-sm">{callData.type === 'video' ? 'Video Call' : 'Voice Call'}</p>
        </div>

        {/* Bottom - Controls */}
        <div className="flex items-center gap-8">
          <button
            onClick={toggleMute}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-500' : 'bg-white/10'}`}
          >
            {isMuted ? <MicOff size={24} className="text-white" /> : <Mic size={24} className="text-white" />}
          </button>

          <button
            onClick={handleEndCall}
            className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30"
          >
            <PhoneOff size={28} className="text-white" />
          </button>

          <button
            onClick={toggleSpeaker}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isSpeaker ? 'bg-primary-500' : 'bg-white/10'}`}
          >
            <Volume2 size={24} className="text-white" />
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // CONNECTING UI
  // ═══════════════════════════════════════════════════════════════
  if (callState === 'connecting') {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-gray-900 to-black flex flex-col items-center justify-center px-4">
        <div className={`w-32 h-32 rounded-full flex items-center justify-center border-4 border-green-500/50 mb-8 ${avatarBg}`}>
          {callerProfile?.avatar ? (
            <img src={callerProfile.avatar} alt="" className="w-full h-full rounded-full object-cover" />
          ) : (
            <span className="text-5xl font-bold text-white">{getInitials(displayName)}</span>
          )}
        </div>
        
        <h2 className="text-2xl font-bold text-white mb-2">{displayName}</h2>
        
        <div className="flex items-center gap-2 mb-8">
          <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-green-400">{connectionStatus || 'Connecting...'}</p>
        </div>
        
        <button
          onClick={handleDecline}
          className="px-6 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-xl transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // INCOMING CALL UI
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="fixed inset-0 bg-gradient-to-b from-gray-900 to-black flex flex-col items-center justify-between py-16 px-4">
      {/* Ringtone */}
      <audio ref={ringtoneRef} src="/sounds/incoming.mp3" loop preload="auto" />
      
      {/* Top - Call type indicator */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10">
          {callData.type === 'video' ? (
            <Video size={18} className="text-primary-400" />
          ) : (
            <Phone size={18} className="text-primary-400" />
          )}
          <span className="text-white/80 text-sm">
            Incoming {callData.type === 'video' ? 'Video' : 'Voice'} Call
          </span>
        </div>
        
        <div className="flex items-center justify-center gap-1.5 mt-3">
          {wsConnected ? (
            <>
              <Wifi size={12} className="text-green-500" />
              <span className="text-green-500 text-xs">Ready</span>
            </>
          ) : (
            <>
              <WifiOff size={12} className="text-yellow-500" />
              <span className="text-yellow-500 text-xs">Connecting...</span>
            </>
          )}
        </div>
      </div>

      {/* Middle - Avatar with pulse animation */}
      <div className="flex flex-col items-center">
        <div className="relative mb-8">
          {/* Pulse rings */}
          <div 
            className="absolute -inset-6 rounded-full border border-primary-500/30 animate-ping" 
            style={{ animationDuration: '2s' }} 
          />
          <div 
            className="absolute -inset-4 rounded-full border border-primary-500/20 animate-pulse" 
          />
          
          {/* Avatar */}
          <div className={`relative w-32 h-32 rounded-full flex items-center justify-center border-4 border-primary-500/50 shadow-2xl shadow-primary-500/20 ${avatarBg}`}>
            {callerProfile?.avatar ? (
              <img src={callerProfile.avatar} alt="" className="w-full h-full rounded-full object-cover" />
            ) : (
              <span className="text-5xl font-bold text-white">{getInitials(displayName)}</span>
            )}
          </div>
        </div>

        <h2 className="text-3xl font-bold text-white mb-2">{displayName}</h2>
        <p className="text-primary-400 text-sm animate-pulse">is calling you...</p>
      </div>

      {/* Bottom - Answer/Decline buttons */}
      <div className="w-full max-w-xs">
        <div className="flex items-center justify-center gap-16">
          {/* Decline */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={handleDecline}
              className="w-[72px] h-[72px] bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-xl shadow-red-500/30 transition-colors active:scale-95"
            >
              <PhoneOff size={30} className="text-white" />
            </button>
            <span className="text-gray-400 text-sm">Decline</span>
          </div>

          {/* Answer */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={handleAnswer}
              disabled={!isAuthenticated || !wsConnected}
              className="w-[72px] h-[72px] bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-full flex items-center justify-center shadow-xl shadow-green-500/30 transition-colors active:scale-95"
              style={{ 
                animation: isAuthenticated && wsConnected ? 'bounce 1s infinite' : 'none' 
              }}
            >
              {callData.type === 'video' ? (
                <Video size={30} className="text-white" />
              ) : (
                <Phone size={30} className="text-white" />
              )}
            </button>
            <span className="text-gray-400 text-sm">Answer</span>
          </div>
        </div>

        {/* Status messages */}
        {!isAuthenticated && (
          <p className="mt-8 text-yellow-500 text-sm text-center">⚠️ Authenticating...</p>
        )}
        {isAuthenticated && !wsConnected && (
          <p className="mt-8 text-yellow-500 text-sm text-center">⚠️ Connecting to server...</p>
        )}
      </div>

      {/* Bounce animation */}
      <style jsx global>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}
