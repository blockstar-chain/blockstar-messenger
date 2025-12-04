import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store';
import { webRTCService } from '@/lib/webrtc';
import { webSocketService } from '@/lib/websocket';
import { PhoneOff, Mic, MicOff, Video, VideoOff, Users, Volume2 } from 'lucide-react';
import { truncateAddress, getInitials, getAvatarColor } from '@/utils/helpers';
import { resolveProfile, type BlockStarProfile } from '@/lib/profileResolver';
import toast from 'react-hot-toast';
import { useSettingReslover } from '@/hooks/useSetting';

interface GroupCallParticipant {
    address: string;
    username?: string;
    avatar?: string;
    stream?: MediaStream;
    isConnected: boolean;
    isMuted: boolean;
    isVideoOff: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

export default function GroupCallModal() {

    const { activeCall, setActiveCall, isCallModalOpen, setCallModalOpen, currentUser } = useAppStore();
    const [isAudioEnabled, setIsAudioEnabled] = useState(true);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);
    const [callDuration, setCallDuration] = useState(0);
    const [callStatus, setCallStatus] = useState<'connecting' | 'ringing' | 'active' | 'ended'>('connecting');
    const [participants, setParticipants] = useState<Map<string, GroupCallParticipant>>(new Map());
    const [participantProfiles, setParticipantProfiles] = useState<Map<string, BlockStarProfile | null>>(new Map());

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const hasEnded = useRef(false);
    const remoteVideoRefs = useRef<Map<string, HTMLVideoElement | null>>(new Map());
    const remoteAudioRefs = useRef<Map<string, HTMLAudioElement | null>>(new Map());
    const domainName = currentUser?.username ? currentUser.username.includes('@') ? currentUser.username.split('@')[0] : currentUser.username : "";
    const stats = useSettingReslover(domainName || '');

    console.log(stats);

    // Check if this is a group call - with null safety
    const isGroupCall = !!(activeCall?.isGroupCall ||
        (Array.isArray(activeCall?.recipientId) && activeCall.recipientId.length > 1) ||
        (activeCall?.participants && activeCall.participants.length > 2));

    // Get all participants except current user - with null safety
    const otherParticipants: string[] = useMemo(() => {
        if (!isGroupCall || !currentUser?.walletAddress) return [];

        const myAddress = currentUser.walletAddress.toLowerCase();

        // First try participants array
        if (activeCall?.participants && Array.isArray(activeCall.participants)) {
            return activeCall.participants
                .filter((p): p is string => typeof p === 'string' && p !== null && p !== undefined)
                .filter(p => p.toLowerCase() !== myAddress);
        }

        // Fall back to recipientId if it's an array
        if (Array.isArray(activeCall?.recipientId)) {
            return activeCall.recipientId
                .filter((p): p is string => typeof p === 'string' && p !== null && p !== undefined)
                .filter(p => p.toLowerCase() !== myAddress);
        }

        return [];
    }, [activeCall?.participants, activeCall?.recipientId, currentUser?.walletAddress, isGroupCall]);

    // Load participant profiles
    useEffect(() => {
        if (!activeCall || !isCallModalOpen || !isGroupCall) return;
        if (otherParticipants.length === 0) return;

        const loadProfiles = async () => {
            try {
                const profiles = new Map<string, BlockStarProfile | null>();

                for (const address of otherParticipants) {
                    if (!address) continue;
                    try {
                        const response = await fetch(`${API_URL}/api/profile/${address.toLowerCase()}`);
                        if (response.ok) {
                            const data = await response.json();
                            if (data.success && data.profile?.nftName) {
                                const profile = await resolveProfile(data.profile.nftName);
                                profiles.set(address.toLowerCase(), profile);
                                continue;
                            }
                        }
                        profiles.set(address.toLowerCase(), null);
                    } catch {
                        profiles.set(address.toLowerCase(), null);
                    }
                }

                setParticipantProfiles(profiles);
            } catch (error) {
                console.error('Error loading participant profiles:', error);
            }
        };

        loadProfiles();
    }, [activeCall?.id, isCallModalOpen, isGroupCall, otherParticipants]);

    // Initialize participants state
    useEffect(() => {
        if (!activeCall || !isCallModalOpen || !isGroupCall) return;

        hasEnded.current = false;

        // Initialize participants
        const initialParticipants = new Map<string, GroupCallParticipant>();
        for (const address of otherParticipants) {
            if (!address) continue;
            initialParticipants.set(address.toLowerCase(), {
                address: address.toLowerCase(),
                isConnected: false,
                isMuted: false,
                isVideoOff: false,
            });
        }
        setParticipants(initialParticipants);

        // Set up local video
        try {
            const localStream = webRTCService.getLocalStream();
            if (localStream && localVideoRef.current && activeCall.type === 'video') {
                localVideoRef.current.srcObject = localStream;
            }
        } catch (error) {
            console.error('Error setting up local video:', error);
        }
    }, [activeCall?.id, isCallModalOpen, isGroupCall, otherParticipants]);

    // Watch for call status
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
    }, [activeCall?.status, activeCall?.callerId, currentUser?.walletAddress]);

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

    // Listen for remote streams from group participants
    useEffect(() => {
        if (!activeCall || !isCallModalOpen) return;

        const unsubscribeStream = webRTCService.onStream((stream, peerId) => {
            console.log('GroupCallModal: Remote stream received from:', peerId);

            // Extract participant address from peer ID (format: callId-participantAddress)
            const parts = peerId.split('-');
            const participantAddress = parts[parts.length - 1];

            if (!participantAddress) return;

            // Update participant with stream
            setParticipants(prev => {
                const updated = new Map(prev);
                const existing = updated.get(participantAddress) || {
                    address: participantAddress,
                    isConnected: false,
                    isMuted: false,
                    isVideoOff: false,
                };
                updated.set(participantAddress, {
                    ...existing,
                    stream,
                    isConnected: true,
                });
                return updated;
            });

            // Set video element
            const videoRef = remoteVideoRefs.current.get(participantAddress);
            if (videoRef && activeCall.type === 'video') {
                videoRef.srcObject = stream;
                videoRef.play().catch(console.warn);
            }

            // Set audio element
            const audioRef = remoteAudioRefs.current.get(participantAddress);
            if (audioRef) {
                audioRef.srcObject = stream;
                audioRef.volume = 1.0;
                audioRef.play().catch(e => {
                    console.warn('Audio autoplay blocked for', participantAddress);
                });
            }

            // Update call status
            setCallStatus('active');
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

    const handlePlayAllAudio = () => {
        remoteAudioRefs.current.forEach((audioRef, address) => {
            if (audioRef) {
                audioRef.volume = 1.0;
                audioRef.muted = false;
                audioRef.play()
                    .then(() => console.log('Audio playing for', address))
                    .catch(e => console.error('Failed to play audio for', address, e));
            }
        });
        toast.success('Audio enabled for all participants');
    };

    const handleEndCall = useCallback((fromRemote = false) => {
        if (hasEnded.current) return;
        hasEnded.current = true;

        const currentActiveCall = useAppStore.getState().activeCall;

        if (currentActiveCall && !fromRemote) {
            webSocketService.endCall(currentActiveCall.id);

            // Notify all participants about call end
            if (currentActiveCall.isGroupCall && currentActiveCall.id) {
                webSocketService.emit('group:call:end', {
                    callId: currentActiveCall.id,
                    groupId: currentActiveCall.id.split('-')[0], // Extract group ID
                });
            }
        }

        webRTCService.cleanup();
        setActiveCall(null);
        setCallModalOpen(false);
        setCallDuration(0);
        setCallStatus('ended');
        setParticipants(new Map());
    }, [setActiveCall, setCallModalOpen]);

    // Call timeout - end call after 60 seconds if no answer from any participant
    useEffect(() => {
        if (!activeCall || callStatus !== 'ringing') return;

        const timeout = setTimeout(() => {
            // Check if any participant connected
            const connectedCount = Array.from(participants.values()).filter(p => p.isConnected).length;
            if (connectedCount === 0) {
                console.log('📞 Group call timeout - no participants answered after 60 seconds');
                toast.error('No answer - call ended');
                handleEndCall();
            }
        }, 60000); // 60 second timeout

        return () => clearTimeout(timeout);
    }, [activeCall?.id, callStatus, participants, handleEndCall]);

    const formatDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const setVideoRef = useCallback((address: string, ref: HTMLVideoElement | null) => {
        remoteVideoRefs.current.set(address, ref);
    }, []);

    const setAudioRef = useCallback((address: string, ref: HTMLAudioElement | null) => {
        remoteAudioRefs.current.set(address, ref);
    }, []);

    if (!activeCall || !isCallModalOpen || !isGroupCall) return null;

    const isVideoCall = activeCall.type === 'video';
    const connectedCount = Array.from(participants.values()).filter(p => p.isConnected).length;

    return (
        <div className="fixed inset-0 bg-midnight z-50 flex flex-col">
            {/* Header */}
            <div className="bg-card/80 backdrop-blur-sm border-b border-midnight p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500/50 to-pink-500/50 flex items-center justify-center">
                            <Users size={20} className="text-white" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-white">
                                {activeCall.groupName || 'Group Call'}
                            </h3>
                            <p className="text-xs text-secondary">
                                {connectedCount + 1} / {otherParticipants.length + 1} connected • {formatDuration(callDuration)}
                            </p>
                        </div>
                    </div>

                    {/* Play all audio button */}
                    <button
                        onClick={handlePlayAllAudio}
                        className="flex items-center gap-2 px-4 py-2 bg-primary-500/20 text-primary-400 rounded-lg hover:bg-primary-500/30 transition"
                    >
                        <Volume2 size={16} />
                        Enable Audio
                    </button>
                </div>
            </div>

            {/* Video Grid */}
            <div className="flex-1 p-4 overflow-hidden">
                <div className={`h-full grid gap-4 ${otherParticipants.length === 1 ? 'grid-cols-1' :
                        otherParticipants.length <= 2 ? 'grid-cols-2' :
                            otherParticipants.length <= 4 ? 'grid-cols-2 grid-rows-2' :
                                otherParticipants.length <= 6 ? 'grid-cols-3 grid-rows-2' :
                                    'grid-cols-3 grid-rows-3'
                    }`}>
                    {/* Other participants */}
                    {otherParticipants.filter(Boolean).map((address) => {
                        if (!address) return null;
                        const normalizedAddress = address.toLowerCase();
                        const participant = participants.get(normalizedAddress);
                        const profile = participantProfiles.get(normalizedAddress);
                        const displayName = profile?.username ? `@${profile.username}` : truncateAddress(normalizedAddress);

                        return (
                            <div
                                key={normalizedAddress}
                                className="relative bg-dark-300 rounded-2xl overflow-hidden border border-midnight"
                            >
                                {/* Hidden audio element */}
                                <audio
                                    ref={(ref) => setAudioRef(normalizedAddress, ref)}
                                    autoPlay
                                    playsInline
                                    style={{ display: 'none' }}
                                />

                                {/* Video or Avatar */}
                                {isVideoCall && participant?.stream ? (
                                    <video
                                        ref={(ref) => setVideoRef(normalizedAddress, ref)}
                                        autoPlay
                                        playsInline
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center">
                                        {profile?.avatar ? (
                                            <img
                                                src={profile.avatar}
                                                alt=""
                                                className="w-24 h-24 rounded-full object-cover mb-4"
                                            />
                                        ) : (
                                            <div
                                                className="w-24 h-24 rounded-full flex items-center justify-center text-white text-3xl font-semibold mb-4"
                                                style={{ backgroundColor: getAvatarColor(normalizedAddress) }}
                                            >
                                                {getInitials(profile?.username || normalizedAddress)}
                                            </div>
                                        )}
                                        <p className="text-white font-medium">{displayName}</p>
                                        <p className="text-sm text-secondary mt-1">
                                            {participant?.isConnected ? 'Connected' : 'Connecting...'}
                                        </p>
                                    </div>
                                )}

                                {/* Participant info overlay */}
                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-white text-sm font-medium">{displayName}</span>
                                        <div className="flex items-center gap-2">
                                            {participant?.isConnected ? (
                                                <span className="w-2 h-2 rounded-full bg-success-500 animate-pulse" />
                                            ) : (
                                                <span className="w-2 h-2 rounded-full bg-warning-500" />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* Local video (self) */}
                    <div className="relative bg-dark-300 rounded-2xl overflow-hidden border-2 border-primary-500/50">
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
                                <div className="w-24 h-24 rounded-full flex items-center justify-center text-white text-3xl font-semibold mb-4"
                                >
                                    {stats.profile ? (
                                        <img
                                            src={stats.profile}
                                            alt={currentUser?.username || 'Profile'}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <>
                                            {getInitials(currentUser?.username || currentUser?.walletAddress)}
                                        </>
                                    )}
                                </div>
                                <p className="text-white font-medium">You</p>
                            </div>
                        )}

                        {/* Self info overlay */}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                            <div className="flex items-center justify-between">
                                <span className="text-white text-sm font-medium">You</span>
                                <div className="flex items-center gap-2">
                                    {!isAudioEnabled && <MicOff size={14} className="text-danger-500" />}
                                    {!isVideoEnabled && isVideoCall && <VideoOff size={14} className="text-danger-500" />}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Call Status Banner */}
            {callStatus !== 'active' && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur-sm px-6 py-3 rounded-full border border-midnight">
                    <p className="text-white text-lg">
                        {callStatus === 'connecting' && '🔄 Connecting to participants...'}
                        {callStatus === 'ringing' && '📞 Calling group members...'}
                        {callStatus === 'ended' && '📵 Call ended'}
                    </p>
                </div>
            )}

            {/* Call Controls */}
            <div className="bg-card/80 backdrop-blur-sm border-t border-midnight p-6">
                <div className="flex items-center justify-center gap-6">
                    <button
                        onClick={handleToggleAudio}
                        className={`p-4 rounded-full transition-all duration-200 ${isAudioEnabled
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
                            className={`p-4 rounded-full transition-all duration-200 ${isVideoEnabled
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
    );
}
