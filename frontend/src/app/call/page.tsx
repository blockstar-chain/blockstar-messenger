// frontend/src/app/call/page.tsx
// Mobile-specific incoming call page for push notifications
// Opens when user taps on incoming call notification
'use client';

import React, { useEffect, useState, useCallback, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Phone, PhoneOff, Video, Wifi, WifiOff } from 'lucide-react';
import { useAppStore } from '@/store';
import { webRTCService } from '@/lib/webrtc';
import { webSocketService } from '@/lib/websocket';
import { getAvatarColor, getInitials, truncateAddress } from '@/utils/helpers';
import toast from 'react-hot-toast';
import { API_BASE } from '@/lib/profileResolver';

// Wrap the main component with Suspense for useSearchParams
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
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    setIncomingCall,
    setActiveCall,
    setCallModalOpen,
    currentUser,
    setCurrentUser
  } = useAppStore();

  const [pulseRing, setPulseRing] = useState(true);
  const [callerProfile, setCallerProfile] = useState<{ name?: string; avatar?: string } | null>(null);
  const [isAnswering, setIsAnswering] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [callData, setCallData] = useState<{
    id: string;
    callerId: string;
    callerName?: string;
    type: 'audio' | 'video';
    authToken?: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const profileFetchedRef = useRef(false);


  // Extract data from URL params and verify token
  useEffect(() => {
    const callId = searchParams.get('callId');
    const callerId = searchParams.get('callerId');
    const callerName = searchParams.get('callerName');
    const callType = searchParams.get('callType') || 'audio';
    const authToken = searchParams.get('token');

    console.log('📱 Mobile call page loaded with params:', {
      callId,
      callerId,
      callerName,
      callType,
      hasToken: !!authToken
    });

    if (!callId || !callerId) {
      setError('Invalid call parameters');
      setIsLoading(false);
      return;
    }

    // Set basic call data immediately for display (only once)
    setCallData({
      id: callId,
      callerId: callerId.toLowerCase(),
      callerName: callerName || undefined,
      type: callType as 'audio' | 'video',
      authToken: authToken || undefined,
    });

    // Authenticate with token if provided
    if (authToken) {
      authenticateWithToken(authToken, callId);
    } else {
      // No token - check if user is already logged in
      if (currentUser?.walletAddress) {
        setIsAuthenticated(true);
        connectWebSocket(currentUser.walletAddress);
      } else {
        setError('Please open the app to answer this call');
      }
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty array - only run on mount, searchParams is stable

  // Authenticate user with token from notification
  const authenticateWithToken = async (token: string, callId: string) => {
    try {
      console.log('🔐 Verifying call token...');

      const response = await fetch(`${API_BASE}/api/calls/verify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Invalid authentication token');
      }

      console.log('✅ Token verified:', data);

      // FIX: Only update callData if the verified data is different
      setCallData(prev => {
        if (!prev) return null;

        // Don't update if nothing changed (prevents loop)
        const needsUpdate =
          prev.callerId !== data.callerId ||
          (!prev.callerName && data.callerName) ||
          prev.type !== data.callType;

        if (!needsUpdate) return prev;

        return {
          ...prev,
          callerId: data.callerId,
          callerName: data.callerName || prev.callerName,
          type: data.callType,
        };
      });

      // Set user if returned
      if (data.user) {
        setCurrentUser({
          walletAddress: data.user.walletAddress,
          username: data.user.username,
        });
      }

      setIsAuthenticated(true);

      // Connect WebSocket
      if (data.user?.walletAddress || data.recipientWallet) {
        connectWebSocket(data.user?.walletAddress || data.recipientWallet);
      }

      setIsLoading(false);

    } catch (error: any) {
      console.error('❌ Authentication failed:', error);
      setError(error.message || 'Authentication failed. The call may have ended.');
      setIsLoading(false);
    }
  };

  // Connect WebSocket for signaling
  const connectWebSocket = (walletAddress: string) => {
    console.log('🔌 Connecting WebSocket for:', walletAddress);

    webSocketService.connect(walletAddress);

    // Listen for connection status
    const checkConnection = setInterval(() => {
      if (webSocketService.isConnected()) {
        setWsConnected(true);
        clearInterval(checkConnection);
        console.log('✅ WebSocket connected');
      }
    }, 500);

    // Timeout after 10 seconds
    setTimeout(() => {
      clearInterval(checkConnection);
      if (!webSocketService.isConnected()) {
        console.warn('⚠️ WebSocket connection timeout');
      }
    }, 10000);
  };

  // Fetch caller profile
  useEffect(() => {
    if (!callData?.callerId || profileFetchedRef.current) return;

    const fetchProfile = async () => {
      try {
        profileFetchedRef.current = true; // Mark as fetched BEFORE the call

        // Use the callerName from params first
        if (callData.callerName) {
          setCallerProfile({ name: callData.callerName });
        }

        // Try to get full profile from API
        const response = await fetch(`${API_BASE}/api/keys/${callData.callerId}`);
        const data = await response.json();

        if (data.success && data.username) {
          setCallerProfile({
            name: data.username,
            avatar: data.avatar
          });
        }
      } catch (error) {
        console.error('Error fetching caller profile:', error);
      }
    };

    fetchProfile();
  }, [callData?.callerId, callData?.callerName]); // Only depend on callerId and callerName

  // Pulse animation
  useEffect(() => {
    if (!callData || error) return;
    const interval = setInterval(() => {
      setPulseRing(prev => !prev);
    }, 1000);
    return () => clearInterval(interval);
  }, [callData, error]);

  // Play ringtone
  useEffect(() => {
    if (!callData || error || isLoading) return;

    let audio: HTMLAudioElement | null = null;

    try {
      audio = new Audio('/sounds/incoming.mp3');
      audio.loop = true;
      audio.play().catch(e => {
        console.warn('Could not play ringtone:', e);
        // Try again on user interaction
      });
      setAudioElement(audio);
    } catch (e) {
      console.warn('Ringtone not available');
    }

    return () => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    };
  }, [callData, error, isLoading]);

  // Stop ringtone helper
  const stopRingtone = useCallback(() => {
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
  }, [audioElement]);

  // Handle answer
  const handleAnswer = useCallback(async () => {
    if (!callData || isAnswering) return;

    setIsAnswering(true);
    stopRingtone();
    console.log('📞 Answering call from mobile:', callData.id);

    try {
      // 1. Get the call offer from server
      console.log('📞 Fetching call offer from server...');

      const offerResponse = await fetch(
        `${API_BASE}/api/calls/${callData.id}/offer${callData.authToken ? `?token=${callData.authToken}` : ''}`
      );

      if (!offerResponse.ok) {
        const errorData = await offerResponse.json();
        throw new Error(errorData.error || 'Call offer not found. The call may have ended.');
      }

      const { offer } = await offerResponse.json();
      console.log('📞 Retrieved offer:', { type: offer?.type, hasSdp: !!offer?.sdp });

      if (!offer || !offer.sdp) {
        throw new Error('Invalid call offer received');
      }

      // 2. Initialize local media stream
      const isVideoCall = callData.type === 'video';
      console.log('📞 Initializing local stream, video:', isVideoCall);
      await webRTCService.initializeLocalStream(!isVideoCall);

      // 3. Create the answering peer connection
      webRTCService.answerCall(
        callData.id,
        !isVideoCall, // audioOnly
        // onSignal - send answer back to caller
        (signal) => {
          console.log('📤 SIGNAL from answerer:', signal.type || 'candidate');

          if (signal.type === 'answer') {
            console.log('📤 Sending ANSWER to caller');
            webSocketService.answerCall(callData.id, signal);
          } else if (signal.candidate) {
            console.log('📤 Sending ICE candidate to caller');
            webSocketService.sendIceCandidate(
              callData.callerId,
              signal,
              callData.id
            );
          }
        }
      );

      // 4. Process the offer to generate answer
      console.log('📞 Processing offer signal...');
      webRTCService.processSignal(callData.id, offer);

      // 5. Store call info for the main app
      sessionStorage.setItem('activeCallData', JSON.stringify({
        callId: callData.id,
        callerId: callData.callerId,
        callerName: callerProfile?.name || callData.callerName,
        callType: callData.type,
        answeredAt: Date.now(),
      }));

      // 6. Transition to active call
      setActiveCall({
        id: callData.id,
        recipientId: callData.callerId,
        callerId: currentUser?.walletAddress || '',
        type: callData.type,
        status: 'active',
        startTime: Date.now(),
      });

      setCallModalOpen(true);

      console.log('✅ Call answered successfully, redirecting to app...');

      // Small delay to let WebRTC stabilize
      // setTimeout(() => {
      //   router.push('/');
      // }, 500);

    } catch (error: any) {
      console.error('❌ Error answering call:', error);
      toast.error('Failed to answer call: ' + error.message);

      // Cleanup on error
      webRTCService.cleanup();
      sessionStorage.removeItem('activeCallData');

      setIsAnswering(false);

      // Go back to app after error
      setTimeout(() => router.push('/'), 2000);
    }
  }, [callData, currentUser, isAnswering, callerProfile, setActiveCall, setCallModalOpen, router, stopRingtone]);

  // Handle decline
  const handleDecline = useCallback(() => {
    if (!callData || isDeclining) return;

    setIsDeclining(true);
    stopRingtone();
    console.log('📞 DECLINING CALL from mobile');
    console.log('  Call ID:', callData.id);
    console.log('  Caller ID:', callData.callerId);

    // Notify caller that call was declined via WebSocket
    if (wsConnected) {
      webSocketService.endCall(callData.id);
    }

    // Also notify via API (in case WebSocket isn't connected)

    fetch(`${API_BASE}/api/calls/${callData.id}/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callerId: callData.callerId,
        reason: 'declined'
      })
    }).catch(err => console.warn('Could not notify decline via API:', err));

    toast('Call declined', { icon: '🔵' });

    // Return to app
    setTimeout(() => router.push('/'), 500);
  }, [callData, isDeclining, wsConnected, router, stopRingtone]);

  // Check if call is still active periodically
  useEffect(() => {
    if (!callData?.id || error || isLoading) return;

    const checkCallStatus = async () => {
      try {

        const response = await fetch(`${API_BASE}/api/calls/${callData.id}/status`);
        const data = await response.json();

        if (data.success && !data.active) {
          console.log('📞 Call is no longer active');
          stopRingtone();
          setError('This call has ended');
        }
      } catch (err) {
        // Ignore errors
      }
    };

    // Check every 5 seconds
    const interval = setInterval(checkCallStatus, 5000);

    return () => clearInterval(interval);
  }, [callData?.id, error, isLoading, stopRingtone]);

  // Loading state
  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-white text-center">
          <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-lg">Connecting...</p>
          <p className="text-sm text-gray-500 mt-2">Verifying call details</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !callData) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <PhoneOff className="w-8 h-8 text-red-500" />
          </div>
          <p className="text-red-400 text-lg mb-2">Call Unavailable</p>
          <p className="text-gray-500 mb-6">{error || 'Invalid call'}</p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-3 bg-primary-500 hover:bg-primary-600 text-white rounded-xl font-medium transition-colors"
          >
            Return to App
          </button>
        </div>
      </div>
    );
  }

  const displayName = callerProfile?.name || callData.callerName || truncateAddress(callData.callerId);
  const avatarBg = getAvatarColor(callData.callerId);
  const callerAvatar = callerProfile?.avatar;
  const callType = callData.type;

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-gray-900 to-black z-[100] flex flex-col items-center justify-between py-12 px-4 safe-area-inset">
      {/* Background animation */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-gradient-to-r from-primary-500/10 to-purple-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 left-1/4 w-[300px] h-[300px] bg-green-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '0.5s' }} />
      </div>

      {/* Top section - Call type and status */}
      <div className="relative z-10 text-center">
        <div className="flex items-center justify-center gap-2 mb-2 px-4 py-2 bg-white/5 backdrop-blur-sm rounded-full border border-white/10">
          {callType === 'video' ? (
            <Video size={18} className="text-primary-400" />
          ) : (
            <Phone size={18} className="text-primary-400" />
          )}
          <span className="text-white/80 text-sm font-medium">
            Incoming {callType === 'video' ? 'Video' : 'Voice'} Call
          </span>
        </div>

        {/* Connection status */}
        <div className="flex items-center justify-center gap-1.5 mt-3">
          {wsConnected ? (
            <>
              <Wifi size={12} className="text-green-500" />
              <span className="text-green-500 text-xs">Connected</span>
            </>
          ) : (
            <>
              <WifiOff size={12} className="text-yellow-500" />
              <span className="text-yellow-500 text-xs">Connecting...</span>
            </>
          )}
        </div>
      </div>

      {/* Middle section - Avatar and caller info */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Avatar with pulse rings */}
        <div className="relative mb-8">
          {/* Outer pulse rings */}
          <div
            className="absolute -inset-8 rounded-full border border-primary-500/20 animate-ping"
            style={{ animationDuration: '2s' }}
          />
          <div
            className={`absolute -inset-4 rounded-full border border-primary-500/30 transition-all duration-1000 ${pulseRing ? 'scale-110 opacity-0' : 'scale-100 opacity-100'}`}
          />
          <div
            className={`absolute -inset-2 rounded-full border border-primary-500/40 transition-all duration-1000 ${!pulseRing ? 'scale-105 opacity-0' : 'scale-100 opacity-100'}`}
          />

          {/* Avatar container */}
          <div className={`relative w-32 h-32 rounded-full flex items-center justify-center overflow-hidden border-4 border-primary-500/50 shadow-2xl shadow-primary-500/20 ${avatarBg}`}>
            {callerAvatar ? (
              <img
                src={callerAvatar}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-5xl font-bold text-white">
                {getInitials(displayName)}
              </span>
            )}
          </div>
        </div>

        {/* Caller info */}
        <h2 className="text-3xl font-bold text-white mb-2 text-center">
          {displayName}
        </h2>

        {callerProfile?.name && callData.callerId && (
          <p className="text-gray-400 text-sm font-mono">
            {truncateAddress(callData.callerId)}
          </p>
        )}

        <p className="text-primary-400 text-sm mt-3 animate-pulse">
          is calling you...
        </p>
      </div>

      {/* Bottom section - Action buttons */}
      <div className="relative z-10 w-full max-w-xs">
        <div className="flex items-center justify-center gap-16">
          {/* Decline button */}
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={handleDecline}
              disabled={isAnswering || isDeclining}
              className="w-18 h-18 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:hover:bg-red-500 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-xl shadow-red-500/30"
              style={{ width: '72px', height: '72px' }}
            >
              {isDeclining ? (
                <div className="w-7 h-7 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <PhoneOff size={30} className="text-white" />
              )}
            </button>
            <span className="text-gray-400 text-sm font-medium">
              {isDeclining ? 'Ending...' : 'Decline'}
            </span>
          </div>

          {/* Answer button */}
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={handleAnswer}
              disabled={isAnswering || isDeclining || !isAuthenticated}
              className="w-18 h-18 bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:hover:bg-green-500 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-xl shadow-green-500/30"
              style={{
                width: '72px',
                height: '72px',
                animation: !isAnswering && isAuthenticated ? 'bounce 1s infinite' : 'none'
              }}
            >
              {isAnswering ? (
                <div className="w-7 h-7 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : callType === 'video' ? (
                <Video size={30} className="text-white" />
              ) : (
                <Phone size={30} className="text-white" />
              )}
            </button>
            <span className="text-gray-400 text-sm font-medium">
              {isAnswering ? 'Connecting...' : 'Answer'}
            </span>
          </div>
        </div>

        {/* Status message */}
        {!isAuthenticated && (
          <p className="mt-8 text-yellow-500 text-sm text-center">
            ⚠️ Authenticating...
          </p>
        )}

        {isAuthenticated && !wsConnected && (
          <p className="mt-8 text-yellow-500 text-sm text-center">
            ⚠️ Establishing connection...
          </p>
        )}
      </div>

      {/* Safe area padding for notch/home indicator */}
      <style jsx global>{`
        .safe-area-inset {
          padding-top: max(env(safe-area-inset-top), 12px);
          padding-bottom: max(env(safe-area-inset-bottom), 12px);
          padding-left: env(safe-area-inset-left);
          padding-right: env(safe-area-inset-right);
        }
        
        @keyframes bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }
      `}</style>
    </div>
  );
}
