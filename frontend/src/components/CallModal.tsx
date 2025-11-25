import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store';
import { webRTCService } from '@/lib/webrtc';
import { webSocketService } from '@/lib/websocket';
import { PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { truncateAddress, getInitials, getAvatarColor } from '@/utils/helpers';
import toast from 'react-hot-toast';

export default function CallModal() {
  const { activeCall, setActiveCall, isCallModalOpen, setCallModalOpen, currentUser } = useAppStore();
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [callStatus, setCallStatus] = useState<'connecting' | 'ringing' | 'active' | 'ended'>('connecting');
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const hasEnded = useRef(false);

  // Set up local video when modal opens
  useEffect(() => {
    if (!activeCall || !isCallModalOpen) return;

    hasEnded.current = false;
    
    // Get the existing local stream and display it
    const localStream = webRTCService.getLocalStream();
    if (localStream && localVideoRef.current && activeCall.type === 'video') {
      localVideoRef.current.srcObject = localStream;
    }

  }, [activeCall?.id, isCallModalOpen]);

  // Watch for call status changes from store
  useEffect(() => {
    if (!activeCall) return;
    
    console.log('CallModal: Checking status update:', {
      activeCallStatus: activeCall.status,
      callerId: activeCall.callerId,
      currentUser: currentUser?.walletAddress,
      callId: activeCall.id
    });
    
    const isCaller = activeCall.callerId.toLowerCase() === currentUser?.walletAddress.toLowerCase();
    console.log('CallModal: isCaller =', isCaller);
    
    if (activeCall.status === 'active') {
      console.log('CallModal: Setting status to ACTIVE (from store status)');
      setCallStatus('active');
    } else if (isCaller) {
      console.log('CallModal: Setting status to RINGING (user is caller, status not active)');
      setCallStatus('ringing');
    } else {
      console.log('CallModal: Setting status to ACTIVE (user is callee)');
      setCallStatus('active'); // Callee accepted, should be active
    }
  }, [activeCall?.status, activeCall?.callerId, activeCall?.id, currentUser?.walletAddress]);

  // Duration timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (callStatus === 'active') {
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [callStatus]);

  // Force re-render to update debug info
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (callStatus === 'active') {
      const interval = setInterval(() => {
        forceUpdate(n => n + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [callStatus]);

  // Listen for remote stream and handle call events
  useEffect(() => {
    if (!activeCall || !isCallModalOpen) return;

    // Handle remote stream
    const unsubscribeStream = webRTCService.onStream((stream, callId) => {
      console.log('CallModal: Received remote stream for call:', callId);
      console.log('CallModal: Current activeCall.id:', activeCall?.id);
      console.log('CallModal: Call IDs match:', callId === activeCall?.id);
      
      // Check what tracks we received
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();
      console.log('Audio tracks:', audioTracks.length, audioTracks.map(t => ({ 
        id: t.id, 
        enabled: t.enabled, 
        muted: t.muted,
        readyState: t.readyState 
      })));
      console.log('Video tracks:', videoTracks.length, videoTracks.map(t => ({ 
        id: t.id, 
        enabled: t.enabled, 
        muted: t.muted,
        readyState: t.readyState 
      })));
      
      // For video calls, set video element
      if (remoteVideoRef.current && activeCall.type === 'video') {
        remoteVideoRef.current.srcObject = stream;
        console.log('Set remote video stream');
      }
      
      // For ALL calls, ALWAYS set audio element
      if (remoteAudioRef.current) {
        console.log('Setting remote audio stream...');
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.volume = 1.0; // Max volume
        remoteAudioRef.current.muted = false; // Ensure not muted
        
        // Check audio context state (may be suspended)
        const audioContext = new AudioContext();
        console.log('AudioContext state:', audioContext.state);
        if (audioContext.state === 'suspended') {
          audioContext.resume().then(() => {
            console.log('AudioContext resumed');
          });
        }
        
        // Monitor audio levels
        try {
          const audioCtx = new AudioContext();
          const analyser = audioCtx.createAnalyser();
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);
          
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          
          const checkAudioLevel = () => {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            if (average > 0) {
              console.log('🔊 Audio level detected:', average.toFixed(2));
            } else {
              console.log('🔇 No audio signal detected');
            }
          };
          
          // Check audio level every 2 seconds
          const levelInterval = setInterval(checkAudioLevel, 2000);
          
          // Clean up on unmount
          return () => clearInterval(levelInterval);
        } catch (e) {
          console.log('Could not monitor audio levels:', e);
        }
        
        // Explicitly play audio
        remoteAudioRef.current.play()
          .then(() => {
            console.log('✅ Remote audio playing successfully');
            console.log('Audio element state:', {
              volume: remoteAudioRef.current?.volume,
              muted: remoteAudioRef.current?.muted,
              paused: remoteAudioRef.current?.paused,
              readyState: remoteAudioRef.current?.readyState,
              currentTime: remoteAudioRef.current?.currentTime
            });
            
            // Try to get audio output device info
            if ('sinkId' in HTMLAudioElement.prototype) {
              console.log('Audio output device (sinkId):', (remoteAudioRef.current as any).sinkId || 'default');
            }
          })
          .catch(e => {
            console.error('❌ Audio autoplay failed:', e);
            toast.error('Click anywhere to enable audio', { duration: 5000 });
            
            // Try to play on next user interaction
            const playOnClick = () => {
              remoteAudioRef.current?.play()
                .then(() => {
                  console.log('✅ Audio playing after user interaction');
                  toast.success('Audio enabled!');
                })
                .catch(err => console.error('❌ Still failed:', err));
              document.removeEventListener('click', playOnClick);
            };
            document.addEventListener('click', playOnClick);
          });
      } else {
        console.error('❌ remoteAudioRef is null!');
      }
      
      // Stream received means connection is active
      console.log('CallModal: Stream received, setting call to ACTIVE');
      setCallStatus('active');
      
      // CRITICAL: Also update the store so other components know call is active
      if (activeCall && callId === activeCall.id) {
        console.log('CallModal: Updating activeCall status in store to ACTIVE');
        setActiveCall({ ...activeCall, status: 'active' });
      }
    });

    return () => {
      unsubscribeStream();
    };
  }, [activeCall?.id, activeCall?.type, isCallModalOpen]);

  const handleToggleAudio = () => {
    const enabled = webRTCService.toggleAudio();
    setIsAudioEnabled(enabled);
  };

  const handleToggleVideo = () => {
    const enabled = webRTCService.toggleVideo();
    setIsVideoEnabled(enabled);
  };

  const handleEndCall = (fromRemote = false) => {
    if (hasEnded.current) return;
    hasEnded.current = true;

    if (activeCall && !fromRemote) {
      webSocketService.endCall(activeCall.id);
    }
    
    webRTCService.cleanup();
    setActiveCall(null);
    setCallModalOpen(false);
    setCallDuration(0);
    setCallStatus('ended');
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!activeCall || !isCallModalOpen) return null;

  const isVideoCall = activeCall.type === 'video';
  const isCaller = activeCall.callerId.toLowerCase() === currentUser?.walletAddress.toLowerCase();
  const otherParty = isCaller ? activeCall.recipientId : activeCall.callerId;

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex items-center justify-center">
      {/* Hidden audio element for remote audio (works for both audio and video calls) */}
      {/* CRITICAL: This element plays the remote user's audio */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        style={{ display: 'none' }}
      />
      
      <div className="w-full h-full relative">
        {/* Remote Video/Avatar */}
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-gray-800 to-gray-900">
          {isVideoCall ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          ) : null}
          
          {/* Show avatar when no video or audio call */}
          {(!isVideoCall || callStatus !== 'active') && (
            <div className="flex flex-col items-center">
              <div className={`w-32 h-32 rounded-full ${getAvatarColor(otherParty)} flex items-center justify-center text-white text-4xl font-semibold mb-6 shadow-2xl`}>
                {getInitials(otherParty)}
              </div>
              <p className="text-white text-2xl font-semibold mb-2">
                {truncateAddress(otherParty)}
              </p>
              <p className="text-gray-400 text-lg">
                {callStatus === 'connecting' && 'Connecting...'}
                {callStatus === 'ringing' && 'Ringing...'}
                {callStatus === 'active' && formatDuration(callDuration)}
                {callStatus === 'ended' && 'Call ended'}
              </p>
              
              {/* Animated rings when ringing */}
              {callStatus === 'ringing' && (
                <div className="absolute">
                  <div className="w-40 h-40 rounded-full border-4 border-primary-500 opacity-20 animate-ping" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Local Video (Picture-in-Picture) */}
        {isVideoCall && (
          <div className="absolute top-6 right-6 w-40 h-56 bg-gray-800 rounded-2xl overflow-hidden shadow-2xl border-2 border-gray-700">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {!isVideoEnabled && (
              <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
                <VideoOff size={32} className="text-gray-500" />
              </div>
            )}
          </div>
        )}

        {/* Call Duration (for video calls when active) */}
        {isVideoCall && callStatus === 'active' && (
          <div className="absolute top-6 left-6 bg-black/50 backdrop-blur-sm text-white px-4 py-2 rounded-full">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              {formatDuration(callDuration)}
            </div>
          </div>
        )}

        {/* Debug: Audio Status Indicator (remove this in production) */}
        {callStatus === 'active' && (
          <div className="absolute top-20 left-6 bg-black/90 backdrop-blur-sm text-white px-4 py-3 rounded-lg text-xs max-w-sm border border-gray-700">
            <div className="font-bold mb-2 text-yellow-400 flex items-center gap-2">
              🔍 Audio Debug Panel
              <span className="text-xs text-gray-400">
                (Status: {callStatus} / Store: {activeCall?.status})
              </span>
              <button
                onClick={() => {
                  const audio = remoteAudioRef.current;
                  console.log('=== FULL AUDIO DEBUG ===');
                  console.log('Audio element:', audio);
                  console.log('srcObject:', audio?.srcObject);
                  console.log('Volume:', audio?.volume);
                  console.log('Muted:', audio?.muted);
                  console.log('Paused:', audio?.paused);
                  console.log('ReadyState:', audio?.readyState);
                  if (audio?.srcObject) {
                    const stream = audio.srcObject as MediaStream;
                    console.log('Stream tracks:', stream.getTracks());
                  }
                  toast.success('Check console (F12) for full debug info');
                }}
                className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded"
              >
                Full Debug
              </button>
            </div>
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span>🎤 Your mic:</span>
                <span className={isAudioEnabled ? 'text-green-400' : 'text-red-400'}>
                  {isAudioEnabled ? '✅ On' : '❌ Off'}
                </span>
              </div>
              
              <div className="border-t border-gray-700 pt-2">
                <div>🔊 Remote stream: {remoteAudioRef.current?.srcObject ? '✅ Receiving' : '❌ No stream'}</div>
                {remoteAudioRef.current?.srcObject && (() => {
                  const stream = remoteAudioRef.current.srcObject as MediaStream;
                  const audioTracks = stream.getAudioTracks();
                  if (audioTracks.length > 0) {
                    const track = audioTracks[0];
                    return (
                      <div className="ml-4 text-gray-300 space-y-1 mt-1">
                        <div>• Enabled: {track.enabled ? '✅' : '❌'}</div>
                        <div>• State: {track.readyState}</div>
                        {track.muted && <div className="text-red-400 font-bold">• ⚠️ MUTED AT SOURCE!</div>}
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
              
              <div className="border-t border-gray-700 pt-2">
                <div>📢 Audio element:</div>
                <div className="ml-4 text-gray-300 space-y-1 mt-1">
                  <div>• Playing: {!remoteAudioRef.current?.paused ? '✅' : '❌'}</div>
                  <div>• Volume: {Math.round((remoteAudioRef.current?.volume || 0) * 100)}%</div>
                  <div>• Muted: {remoteAudioRef.current?.muted ? '❌ Yes' : '✅ No'}</div>
                </div>
              </div>

              {/* Troubleshooting buttons */}
              <div className="border-t border-gray-700 pt-2 space-y-2">
                <div className="font-semibold text-yellow-300">Quick Fixes:</div>
                
                <button
                  onClick={() => {
                    if (remoteAudioRef.current) {
                      remoteAudioRef.current.volume = 1.0;
                      remoteAudioRef.current.muted = false;
                      remoteAudioRef.current.play()
                        .then(() => toast.success('Audio restarted!'))
                        .catch(e => toast.error('Failed: ' + e.message));
                    }
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded text-white font-medium"
                >
                  🔄 Restart Audio
                </button>

                <button
                  onClick={() => {
                    const audio = new Audio();
                    audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
                    audio.play()
                      .then(() => toast.success('✅ System audio works! Issue is with call audio.'))
                      .catch(() => toast.error('❌ System audio not working! Check system volume.'));
                  }}
                  className="w-full bg-purple-600 hover:bg-purple-500 px-3 py-2 rounded text-white font-medium"
                >
                  🔊 Test System Audio
                </button>

                <button
                  onClick={() => {
                    // Create audio context and route through it
                    if (remoteAudioRef.current?.srcObject) {
                      try {
                        const stream = remoteAudioRef.current.srcObject as MediaStream;
                        const audioContext = new AudioContext();
                        const source = audioContext.createMediaStreamSource(stream);
                        const gainNode = audioContext.createGain();
                        gainNode.gain.value = 2.0; // Boost volume
                        source.connect(gainNode);
                        gainNode.connect(audioContext.destination);
                        toast.success('Audio routed through AudioContext with 2x gain');
                      } catch (e: any) {
                        toast.error('Failed: ' + e.message);
                      }
                    }
                  }}
                  className="w-full bg-green-600 hover:bg-green-500 px-3 py-2 rounded text-white font-medium"
                >
                  🔊 Boost Audio (2x)
                </button>
              </div>

              {remoteAudioRef.current?.srcObject && (() => {
                const stream = remoteAudioRef.current.srcObject as MediaStream;
                const audioTracks = stream.getAudioTracks();
                if (audioTracks.length > 0 && audioTracks[0].muted) {
                  return (
                    <div className="mt-2 p-2 bg-red-900/50 border border-red-500 rounded text-xs">
                      <div className="font-bold text-red-300">⚠️ Other user's mic is MUTED</div>
                      <div className="text-gray-300 mt-1">
                        Ask them to check their system audio settings
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          </div>
        )}

        {/* Call Controls */}
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-6 bg-gray-800/80 backdrop-blur-sm px-8 py-4 rounded-full">
            <button
              onClick={handleToggleAudio}
              className={`p-4 rounded-full transition-all duration-200 ${
                isAudioEnabled 
                  ? 'bg-gray-700 hover:bg-gray-600' 
                  : 'bg-red-500 hover:bg-red-600'
              }`}
              title={isAudioEnabled ? 'Mute' : 'Unmute'}
            >
              {isAudioEnabled ? (
                <Mic size={24} className="text-white" />
              ) : (
                <MicOff size={24} className="text-white" />
              )}
            </button>

            <button
              onClick={() => handleEndCall(false)}
              className="p-5 bg-red-500 hover:bg-red-600 rounded-full transition-all duration-200 transform hover:scale-105"
              title="End call"
            >
              <PhoneOff size={28} className="text-white" />
            </button>

            {isVideoCall && (
              <button
                onClick={handleToggleVideo}
                className={`p-4 rounded-full transition-all duration-200 ${
                  isVideoEnabled 
                    ? 'bg-gray-700 hover:bg-gray-600' 
                    : 'bg-red-500 hover:bg-red-600'
                }`}
                title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
              >
                {isVideoEnabled ? (
                  <Video size={24} className="text-white" />
                ) : (
                  <VideoOff size={24} className="text-white" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
