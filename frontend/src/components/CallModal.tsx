import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store';
import { webRTCService } from '@/lib/webrtc';
import { webSocketService } from '@/lib/websocket';
import { PhoneOff, Mic, MicOff, Video, VideoOff, Users } from 'lucide-react';
import { truncateAddress, getInitials, getAvatarColor } from '@/utils/helpers';
import { resolveProfile, type BlockStarProfile } from '@/lib/profileResolver';
import toast from 'react-hot-toast';

interface ParticipantStream {
  address: string;
  stream: MediaStream | null;
  profile: BlockStarProfile | null;
  isConnected: boolean;
}

export default function CallModal() {
  const { activeCall, setActiveCall, isCallModalOpen, setCallModalOpen, currentUser } = useAppStore();
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [callStatus, setCallStatus] = useState<'connecting' | 'ringing' | 'active' | 'ended'>('connecting');
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [remoteAudioPlaying, setRemoteAudioPlaying] = useState(false);
  const [participantStreams, setParticipantStreams] = useState<Map<string, ParticipantStream>>(new Map());
  const [myProfile, setMyProfile] = useState<BlockStarProfile | null>(null);
  const [otherPartyProfile, setOtherPartyProfile] = useState<BlockStarProfile | null>(null);
  const [myAvatarFailed, setMyAvatarFailed] = useState(false);
  
  // Reset avatar failed state when call opens
  useEffect(() => {
    if (isCallModalOpen) {
      setMyAvatarFailed(false);
    }
  }, [isCallModalOpen]);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const groupAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const hasEnded = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  const isGroupCall = activeCall?.isGroupCall || Array.isArray(activeCall?.recipientId);
  const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

  // Load current user's profile - use same method as other participants
  useEffect(() => {
    if (!currentUser?.walletAddress || !isCallModalOpen) return;
    
    // If currentUser already has an avatar, use it immediately
    if (currentUser.avatar) {
      console.log('✅ [MyProfile] Using currentUser.avatar:', currentUser.avatar);
      setMyProfile({
        username: currentUser.username || '',
        fullUsername: `${currentUser.username}@blockstar`,
        walletAddress: currentUser.walletAddress,
        avatar: currentUser.avatar,
        records: {},
        subdomains: [],
        isSubdomain: false,
        mainDomain: currentUser.username || '',
        subDomain: '',
        resolvedAt: Date.now(),
      });
      return;
    }
    
    const loadMyProfile = async () => {
      console.log('🔍 [MyProfile] Starting profile load for:', currentUser.walletAddress);
      console.log('🔍 [MyProfile] Username:', currentUser.username);
      
      try {
        // Method 1: Use the same API call that works for other participants
        const response = await fetch(`${API_URL}/api/profile/${currentUser.walletAddress.toLowerCase()}`);
        console.log('📡 [MyProfile] API response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('📦 [MyProfile] API data:', JSON.stringify(data));
          
          if (data.success && data.profile?.nftName) {
            console.log('🔍 [MyProfile] Resolving nftName:', data.profile.nftName);
            const profile = await resolveProfile(data.profile.nftName);
            console.log('📦 [MyProfile] Resolved profile:', JSON.stringify(profile));
            
            if (profile) {
              console.log('✅ [MyProfile] Setting myProfile with avatar:', profile.avatar);
              setMyProfile(profile);
              return;
            }
          }
        }
        
        // Method 2: Try resolving by username directly
        if (currentUser.username) {
          const username = currentUser.username.replace('@', ''); // Remove @ if present
          console.log('🔍 [MyProfile] Trying direct username resolve:', username);
          
          const profile = await resolveProfile(username);
          console.log('📦 [MyProfile] Direct resolve result:', JSON.stringify(profile));
          
          if (profile?.avatar) {
            console.log('✅ [MyProfile] Setting myProfile from direct resolve:', profile.avatar);
            setMyProfile(profile);
            return;
          }
        }
        
        console.log('⚠️ [MyProfile] No avatar found for current user');
      } catch (error) {
        console.error('❌ [MyProfile] Error loading profile:', error);
      }
    };
    
    loadMyProfile();
  }, [currentUser?.walletAddress, currentUser?.username, currentUser?.avatar, isCallModalOpen, API_URL]);

  // Load other party's profile for direct calls
  useEffect(() => {
    if (isGroupCall || !activeCall || !isCallModalOpen) return;
    
    const isCaller = activeCall.callerId?.toLowerCase() === currentUser?.walletAddress?.toLowerCase();
    const otherAddress = isCaller ? activeCall.recipientId : activeCall.callerId;
    
    if (!otherAddress) return;
    
    const loadOtherProfile = async () => {
      try {
        const response = await fetch(`${API_URL}/api/profile/${otherAddress.toLowerCase()}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.profile?.nftName) {
            const profile = await resolveProfile(data.profile.nftName);
            setOtherPartyProfile(profile);
          }
        }
      } catch (error) {
        console.error('Error loading other party profile:', error);
      }
    };
    
    loadOtherProfile();
  }, [activeCall, isGroupCall, isCallModalOpen, currentUser?.walletAddress]);

  // Load participant profiles for group calls
  useEffect(() => {
    if (!isGroupCall || !activeCall?.participants) return;

    const loadProfiles = async () => {
      const newStreams = new Map<string, ParticipantStream>();
      
      // Also load current user's profile at the same time
      if (currentUser?.walletAddress && !currentUser?.avatar && !myProfile?.avatar) {
        try {
          console.log('🔍 [Participants] Loading myProfile for:', currentUser.walletAddress);
          const myResponse = await fetch(`${API_URL}/api/profile/${currentUser.walletAddress.toLowerCase()}`);
          if (myResponse.ok) {
            const myData = await myResponse.json();
            console.log('📦 [Participants] My profile API response:', myData);
            if (myData.success && myData.profile?.nftName) {
              const myProfileResolved = await resolveProfile(myData.profile.nftName);
              console.log('📦 [Participants] My profile resolved:', myProfileResolved?.avatar);
              if (myProfileResolved) {
                setMyProfile(myProfileResolved);
              }
            }
          }
        } catch (error) {
          console.error('Error loading my profile in participants:', error);
        }
      }
      
      for (const address of activeCall.participants) {
        if (address.toLowerCase() === currentUser?.walletAddress.toLowerCase()) continue;
        
        let profile: BlockStarProfile | null = null;
        try {
          const response = await fetch(`${API_URL}/api/profile/${address.toLowerCase()}`);
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.profile?.nftName) {
              profile = await resolveProfile(data.profile.nftName);
            }
          }
        } catch (error) {
          console.error('Error loading profile:', error);
        }

        newStreams.set(address.toLowerCase(), {
          address: address.toLowerCase(),
          stream: null,
          profile,
          isConnected: false,
        });
      }
      
      setParticipantStreams(newStreams);
    };

    loadProfiles();
  }, [activeCall?.participants, isGroupCall, currentUser?.walletAddress, currentUser?.avatar, API_URL]);

  // Set up local video when modal opens
  useEffect(() => {
    if (!activeCall || !isCallModalOpen) return;

    hasEnded.current = false;
    setHasRemoteStream(false);
    setRemoteAudioPlaying(false);
    
    // Get the existing local stream and display it
    const localStream = webRTCService.getLocalStream();
    if (localStream && localVideoRef.current && activeCall.type === 'video') {
      localVideoRef.current.srcObject = localStream;
    }

  }, [activeCall?.id, isCallModalOpen]);

  // Watch for call status changes from store
  useEffect(() => {
    if (!activeCall) return;
    
    const isCaller = activeCall.callerId?.toLowerCase() === currentUser?.walletAddress?.toLowerCase();
    
    if (activeCall.status === 'active') {
      setCallStatus('active');
    } else if (isCaller) {
      setCallStatus('ringing');
    } else {
      setCallStatus('active');
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

  // Listen for remote streams
  useEffect(() => {
    if (!activeCall || !isCallModalOpen) return;

    const unsubscribeStream = webRTCService.onStream((stream, callId, peerId) => {
      console.log('========================================');
      console.log('CallModal: REMOTE STREAM RECEIVED');
      console.log('CallModal: Stream ID:', stream.id);
      console.log('CallModal: Call ID:', callId);
      console.log('CallModal: Peer ID:', peerId);
      console.log('CallModal: Active:', stream.active);
      console.log('========================================');
      
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();
      
      console.log('Audio tracks:', audioTracks.length);
      console.log('Video tracks:', videoTracks.length);
      
      setHasRemoteStream(true);
      
      if (isGroupCall && peerId) {
        // Group call - handle per-participant streams
        // Extract participant address from peerId (format: callId-address)
        const parts = peerId.split('-');
        const participantAddress = parts[parts.length - 1]?.toLowerCase();
        
        if (participantAddress) {
          setParticipantStreams(prev => {
            const newMap = new Map(prev);
            const existing = newMap.get(participantAddress) || {
              address: participantAddress,
              stream: null,
              profile: null,
              isConnected: false,
            };
            newMap.set(participantAddress, {
              ...existing,
              stream,
              isConnected: true,
            });
            return newMap;
          });

          // Create audio element for this participant
          let audioEl = groupAudioRefs.current.get(participantAddress);
          if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.autoplay = true;
            audioEl.playsInline = true;
            groupAudioRefs.current.set(participantAddress, audioEl);
          }
          audioEl.srcObject = stream;
          audioEl.volume = 1.0;
          audioEl.play().catch(e => console.warn('Audio play failed:', e));
        }

        // Set call to active when we have connections
        setCallStatus('active');
        if (activeCall) {
          setActiveCall({ ...activeCall, status: 'active' });
        }
      } else {
        // Direct call - existing logic
        if (remoteVideoRef.current && activeCall.type === 'video') {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.play().catch(e => console.warn('Video play failed:', e));
        }
        
        if (remoteAudioRef.current) {
          console.log('Setting audio element srcObject...');
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.volume = 1.0;
          remoteAudioRef.current.muted = false;
          
          remoteAudioRef.current.play()
            .then(() => {
              console.log('✅ Audio element playing!');
              setRemoteAudioPlaying(true);
            })
            .catch((e) => {
              console.warn('Audio autoplay blocked:', e);
              toast('Click "Play Audio" to hear the caller', { icon: '🔊', duration: 5000 });
            });
        }
        
        setCallStatus('active');
        if (activeCall && callId === activeCall.id) {
          setActiveCall({ ...activeCall, status: 'active' });
        }
      }
    });

    return () => {
      unsubscribeStream();
    };
  }, [activeCall?.id, activeCall?.type, isCallModalOpen, isGroupCall, setActiveCall]);

  // Listen for group call events
  useEffect(() => {
    if (!activeCall || !isCallModalOpen || !isGroupCall) return;

    // Listen for participant joined
    const unsubJoined = webSocketService.on('group:call:participant:joined', (data: any) => {
      console.log('Participant joined group call:', data);
      toast.success(`${truncateAddress(data.participantAddress)} joined the call`);
    });

    // Listen for participant left
    const unsubLeft = webSocketService.on('group:call:participant:left', (data: any) => {
      console.log('Participant left group call:', data);
      toast(`${truncateAddress(data.participantAddress)} left the call`, { icon: '👋' });
      
      setParticipantStreams(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(data.participantAddress.toLowerCase());
        if (existing) {
          newMap.set(data.participantAddress.toLowerCase(), {
            ...existing,
            stream: null,
            isConnected: false,
          });
        }
        return newMap;
      });
    });

    return () => {
      unsubJoined();
      unsubLeft();
    };
  }, [activeCall?.id, isCallModalOpen, isGroupCall]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      // Cleanup group audio elements
      groupAudioRefs.current.forEach(audio => {
        audio.srcObject = null;
      });
      groupAudioRefs.current.clear();
    };
  }, []);

  const handleToggleAudio = () => {
    const enabled = webRTCService.toggleAudio();
    setIsAudioEnabled(enabled);
  };

  const handleToggleVideo = () => {
    const enabled = webRTCService.toggleVideo();
    setIsVideoEnabled(enabled);
  };

  const handlePlayAudio = () => {
    if (isGroupCall) {
      // Play all group audio elements
      groupAudioRefs.current.forEach(audio => {
        audio.volume = 1.0;
        audio.play().catch(e => console.warn('Play failed:', e));
      });
      setRemoteAudioPlaying(true);
      toast.success('Audio enabled!');
    } else if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = 1.0;
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.play()
        .then(() => {
          console.log('✅ Audio playing after button click');
          setRemoteAudioPlaying(true);
          toast.success('Audio enabled!');
        })
        .catch(e => {
          console.error('Play failed:', e);
          toast.error('Failed to play audio: ' + e.message);
        });
    }
  };

  const handleBoostAudio = () => {
    const stream = isGroupCall 
      ? Array.from(participantStreams.values()).find(p => p.stream)?.stream
      : (remoteAudioRef.current?.srcObject as MediaStream);
    
    if (stream) {
      try {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          audioContextRef.current = new AudioContext();
        }
        
        const audioContext = audioContextRef.current;
        
        if (audioContext.state === 'suspended') {
          audioContext.resume();
        }
        
        const source = audioContext.createMediaStreamSource(stream);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 3.0;
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        toast.success('Audio boosted 3x!');
      } catch (e: any) {
        toast.error('Failed: ' + e.message);
      }
    } else {
      toast.error('No remote stream to boost');
    }
  };

  const handleEndCall = (fromRemote = false) => {
    if (hasEnded.current) return;
    hasEnded.current = true;

    if (activeCall && !fromRemote) {
      if (isGroupCall) {
        // Notify all participants
        webSocketService.emit('group:call:end', {
          callId: activeCall.id,
          participantAddress: currentUser?.walletAddress,
        });
      } else {
        webSocketService.endCall(activeCall.id);
      }
    }
    
    // Cleanup audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Cleanup group audio elements
    groupAudioRefs.current.forEach(audio => {
      audio.srcObject = null;
    });
    groupAudioRefs.current.clear();
    
    webRTCService.cleanup();
    setActiveCall(null);
    setCallModalOpen(false);
    setCallDuration(0);
    setCallStatus('ended');
    setParticipantStreams(new Map());
    setMyProfile(null);
    setOtherPartyProfile(null);
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!activeCall || !isCallModalOpen) return null;

  const isVideoCall = activeCall.type === 'video';
  const isCaller = activeCall?.callerId?.toLowerCase() === currentUser?.walletAddress?.toLowerCase();
  
  // For direct calls
  const otherParty = !isGroupCall 
    ? (isCaller ? (activeCall?.recipientId || 'Unknown') : (activeCall?.callerId || 'Unknown'))
    : null;

  // Count connected participants for group calls
  const connectedCount = Array.from(participantStreams.values()).filter(p => p.isConnected).length;
  const totalParticipants = participantStreams.size;

  return (
    <div className="fixed inset-0 bg-midnight z-50 flex items-center justify-center">
      {/* Audio element for direct calls */}
      {!isGroupCall && (
        <audio
          ref={remoteAudioRef}
          autoPlay
          playsInline
          style={{ display: 'none' }}
        />
      )}
      
      <div className="w-full h-full relative">
        {/* Remote Video/Avatar Area */}
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-dark-300 to-midnight">
          {isGroupCall ? (
            // Group call layout
            <div className="w-full h-full p-6">
              {/* Group call header */}
              <div className="text-center mb-6">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Users size={24} className="text-primary-400" />
                  <h2 className="text-2xl font-bold text-white">
                    {activeCall.groupName || 'Group Call'}
                  </h2>
                </div>
                <p className="text-secondary">
                  {callStatus === 'ringing' && `Calling ${totalParticipants} participants...`}
                  {callStatus === 'active' && `${connectedCount} of ${totalParticipants} connected • ${formatDuration(callDuration)}`}
                  {callStatus === 'connecting' && 'Connecting...'}
                </p>
              </div>

              {/* Participants grid - includes YOU */}
              <div className={`grid gap-4 max-w-5xl mx-auto ${
                (totalParticipants + 1) <= 2 ? 'grid-cols-2' :
                (totalParticipants + 1) <= 4 ? 'grid-cols-2' :
                (totalParticipants + 1) <= 6 ? 'grid-cols-3' :
                'grid-cols-4'
              }`}>
                {/* Current user's tile (You) */}
                <div
                  className="relative aspect-video bg-dark-200 rounded-2xl overflow-hidden border-2 border-primary-500"
                >
                  {isVideoCall ? (
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center">
                      {/* Show avatar if URL exists AND image hasn't failed to load */}
                      {((currentUser?.avatar || myProfile?.avatar) && !myAvatarFailed) ? (
                        <img
                          src={currentUser?.avatar || myProfile?.avatar}
                          alt="Your avatar"
                          className="w-20 h-20 rounded-full object-cover mb-3"
                          onLoad={(e) => {
                            console.log('✅ [Avatar] Image loaded successfully, dimensions:', e.currentTarget.naturalWidth, 'x', e.currentTarget.naturalHeight);
                          }}
                          onError={(e) => {
                            console.error('❌ [Avatar] Image failed to load:', e.currentTarget.src);
                            setMyAvatarFailed(true);
                          }}
                        />
                      ) : (
                        <div
                          className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-semibold mb-3 ${getAvatarColor(currentUser?.walletAddress || '')}`}
                        >
                          {getInitials(currentUser?.username || myProfile?.username || currentUser?.walletAddress || '')}
                        </div>
                      )}
                      <p className="text-white font-medium">
                        {currentUser?.username 
                          ? `@${currentUser.username}`
                          : myProfile?.username 
                            ? `@${myProfile.username}`
                            : truncateAddress(currentUser?.walletAddress || '')
                        }
                      </p>
                      <p className="text-sm text-primary-400 mt-1">You</p>
                    </div>
                  )}
                  
                  {/* "You" label for video mode */}
                  {isVideoCall && (
                    <div className="absolute bottom-2 left-2 text-xs text-white bg-primary-500/80 px-2 py-1 rounded">
                      You
                    </div>
                  )}
                  
                  {/* Always connected indicator for self */}
                  <div className="absolute top-3 right-3 w-3 h-3 rounded-full bg-success-500 shadow-glow-green" />
                </div>
                
                {/* Other participants */}
                {Array.from(participantStreams.values()).map((participant) => (
                  <div
                    key={participant.address}
                    className={`relative aspect-video bg-dark-200 rounded-2xl overflow-hidden border-2 ${
                      participant.isConnected ? 'border-success-500' : 'border-midnight'
                    }`}
                  >
                    {isVideoCall && participant.stream ? (
                      <video
                        autoPlay
                        playsInline
                        ref={(el) => {
                          if (el && participant.stream) {
                            el.srcObject = participant.stream;
                          }
                        }}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center">
                        {participant.profile?.avatar ? (
                          <img
                            src={participant.profile.avatar}
                            alt=""
                            className="w-20 h-20 rounded-full object-cover mb-3"
                          />
                        ) : (
                          <div
                            className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-semibold mb-3 ${getAvatarColor(participant.address)}`}
                          >
                            {getInitials(participant.profile?.username || participant.address)}
                          </div>
                        )}
                        <p className="text-white font-medium">
                          {participant.profile?.username 
                            ? `@${participant.profile.username}`
                            : truncateAddress(participant.address)
                          }
                        </p>
                        <p className="text-sm text-secondary mt-1">
                          {participant.isConnected ? '🟢 Connected' : '⏳ Connecting...'}
                        </p>
                      </div>
                    )}

                    {/* Connection status indicator */}
                    <div className={`absolute top-3 right-3 w-3 h-3 rounded-full ${
                      participant.isConnected ? 'bg-success-500 shadow-glow-green' : 'bg-warning-500 animate-pulse'
                    }`} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            // Direct call layout - show both participants
            <>
              {isVideoCall ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : null}
              
              {(!isVideoCall || callStatus !== 'active') && (
                <div className="flex flex-col items-center">
                  {/* Both avatars side by side */}
                  <div className="flex items-center justify-center gap-8 mb-8">
                    {/* Your avatar */}
                    <div className="flex flex-col items-center">
                      {(currentUser?.avatar || myProfile?.avatar) ? (
                        <img
                          src={currentUser?.avatar || myProfile?.avatar}
                          alt=""
                          className="w-24 h-24 rounded-full object-cover mb-2 ring-4 ring-primary-500"
                        />
                      ) : (
                        <div
                          className={`w-24 h-24 rounded-full flex items-center justify-center text-white text-3xl font-semibold mb-2 ring-4 ring-primary-500 ${getAvatarColor(currentUser?.walletAddress || '')}`}
                        >
                          {getInitials(myProfile?.username || currentUser?.username || currentUser?.walletAddress || '')}
                        </div>
                      )}
                      <p className="text-white font-medium text-sm">
                        {myProfile?.username 
                          ? `@${myProfile.username}`
                          : currentUser?.username 
                            ? `@${currentUser.username}`
                            : truncateAddress(currentUser?.walletAddress || '')
                        }
                      </p>
                      <p className="text-primary-400 text-xs">You</p>
                    </div>
                    
                    {/* Call status indicator between avatars */}
                    <div className="flex flex-col items-center">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                        callStatus === 'active' ? 'bg-success-500/20' : 'bg-primary-500/20'
                      }`}>
                        {callStatus === 'active' ? (
                          <span className="text-2xl">🔊</span>
                        ) : callStatus === 'ringing' ? (
                          <span className="text-2xl animate-pulse">📞</span>
                        ) : (
                          <span className="text-2xl animate-spin">⏳</span>
                        )}
                      </div>
                    </div>
                    
                    {/* Other party avatar */}
                    <div className="flex flex-col items-center">
                      {otherPartyProfile?.avatar ? (
                        <img
                          src={otherPartyProfile.avatar}
                          alt=""
                          className="w-24 h-24 rounded-full object-cover mb-2 ring-4 ring-cyan-500"
                        />
                      ) : (
                        <div
                          className={`w-24 h-24 rounded-full flex items-center justify-center text-white text-3xl font-semibold mb-2 ring-4 ring-cyan-500 ${getAvatarColor(otherParty as string || '')}`}
                        >
                          {getInitials(otherPartyProfile?.username || otherParty as string || '')}
                        </div>
                      )}
                      <p className="text-white font-medium text-sm">
                        {otherPartyProfile?.username 
                          ? `@${otherPartyProfile.username}`
                          : truncateAddress(otherParty as string || '')
                        }
                      </p>
                    </div>
                  </div>
                  
                  {/* Call status text */}
                  <p className="text-secondary text-lg">
                    {callStatus === 'connecting' && 'Connecting...'}
                    {callStatus === 'ringing' && 'Ringing...'}
                    {callStatus === 'active' && formatDuration(callDuration)}
                    {callStatus === 'ended' && 'Call ended'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Local Video (picture-in-picture) */}
        {isVideoCall && (
          <div className="absolute top-6 right-6 w-48 h-36 bg-dark-300 rounded-xl overflow-hidden border-2 border-midnight shadow-lg">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-2 left-2 text-xs text-white bg-black/50 px-2 py-1 rounded">
              You
            </div>
          </div>
        )}

        {/* Audio Status & Controls Panel */}
        {callStatus === 'active' && (
          <div className="absolute top-6 left-6 bg-card/95 backdrop-blur-sm text-white px-4 py-3 rounded-xl text-sm max-w-xs border border-midnight">
            <div className="font-bold mb-2 text-primary-400">
              🔊 {isGroupCall ? 'Group Call' : 'Audio Status'}
            </div>
            
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span>Your mic:</span>
                <span className={isAudioEnabled ? 'text-success-500' : 'text-danger-500'}>
                  {isAudioEnabled ? '✅ On' : '❌ Off'}
                </span>
              </div>
              
              {isGroupCall ? (
                <div className="flex items-center justify-between">
                  <span>Connected:</span>
                  <span className="text-success-500">
                    {connectedCount}/{totalParticipants} participants
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span>Remote stream:</span>
                    <span className={hasRemoteStream ? 'text-success-500' : 'text-warning-500'}>
                      {hasRemoteStream ? '✅ Connected' : '⏳ Waiting...'}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span>Audio playing:</span>
                    <span className={remoteAudioPlaying ? 'text-success-500' : 'text-danger-500'}>
                      {remoteAudioPlaying ? '✅ Yes' : '❌ No'}
                    </span>
                  </div>
                </>
              )}
            </div>
            
            {/* Action buttons */}
            <div className="mt-3 space-y-2">
              {!remoteAudioPlaying && (hasRemoteStream || connectedCount > 0) && (
                <button
                  onClick={handlePlayAudio}
                  className="w-full bg-success-600 hover:bg-success-500 px-3 py-2 rounded-lg text-white font-medium transition text-sm"
                >
                  ▶️ Play Audio
                </button>
              )}
              
              {(hasRemoteStream || connectedCount > 0) && (
                <button
                  onClick={handleBoostAudio}
                  className="w-full bg-primary-600 hover:bg-primary-500 px-3 py-2 rounded-lg text-white font-medium transition text-sm"
                >
                  🔊 Boost Audio (3x)
                </button>
              )}
            </div>
          </div>
        )}

        {/* Call Controls */}
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-6 bg-card/80 backdrop-blur-sm px-8 py-4 rounded-full border border-midnight">
            <button
              onClick={handleToggleAudio}
              className={`p-4 rounded-full transition-all duration-200 ${
                isAudioEnabled 
                  ? 'bg-dark-200 hover:bg-dark-100' 
                  : 'bg-danger-500 hover:bg-danger-600'
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
              className="p-5 bg-danger-500 hover:bg-danger-600 rounded-full transition-all duration-200 transform hover:scale-105 shadow-glow"
              title="End call"
            >
              <PhoneOff size={28} className="text-white" />
            </button>

            {isVideoCall && (
              <button
                onClick={handleToggleVideo}
                className={`p-4 rounded-full transition-all duration-200 ${
                  isVideoEnabled 
                    ? 'bg-dark-200 hover:bg-dark-100' 
                    : 'bg-danger-500 hover:bg-danger-600'
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
