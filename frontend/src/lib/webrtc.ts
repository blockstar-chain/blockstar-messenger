import SimplePeer from 'simple-peer';
import { WebRTCConnection } from '@/types';
import { requestCallPermissions, getPermissionErrorMessage, isNative, platform } from './mediaPermissions';

// Get TURN server config from environment or use free public servers
const TURN_SERVER_URL = process.env.NEXT_PUBLIC_TURN_SERVER_URL;
const TURN_USERNAME = process.env.NEXT_PUBLIC_TURN_USERNAME;
const TURN_CREDENTIAL = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

// Build ICE servers configuration
function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];

  if (TURN_SERVER_URL && TURN_USERNAME && TURN_CREDENTIAL) {
    servers.push({
      urls: TURN_SERVER_URL,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    });
    console.log('🔧 Using custom TURN server:', TURN_SERVER_URL);
  } else {
    // OpenRelay TURN servers (free)
    servers.push(
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      }
    );
    console.log('🔧 Using free public TURN servers');
  }

  return servers;
}

export class WebRTCService {
  private peers: Map<string, SimplePeer.Instance> = new Map();
  private localStream: MediaStream | null = null;
  private onStreamHandlers: Set<(stream: MediaStream, callId: string, peerId?: string) => void> = new Set();
  private onCallEndHandlers: Set<(callId: string) => void> = new Set();
  private onConnectionStateHandlers: Set<(state: string, callId: string) => void> = new Set();
  private audioMonitorInterval: NodeJS.Timeout | null = null;
  private pendingCandidates: Map<string, any[]> = new Map(); // Queue for ICE candidates that arrive before peer

  /**
   * Initialize local media stream
   */
  async initializeLocalStream(audioOnly: boolean = false): Promise<MediaStream> {
    try {
      console.log('========================================');
      console.log('📱 INITIALIZING LOCAL STREAM');
      console.log('📱 Audio only:', audioOnly);
      console.log('📱 Platform:', platform, 'isNative:', isNative);
      console.log('========================================');

      // On native platforms, we need to request permissions first
      // This triggers the native permission dialog
      if (isNative) {
        console.log('📱 Native platform detected - requesting permissions first...');
        
        const permResult = await requestCallPermissions(!audioOnly);
        
        if (!permResult.success) {
          console.error('❌ Permission request failed:', permResult.error);
          throw new Error(permResult.error || 'Permission denied');
        }
        
        console.log('✅ Permissions granted:', {
          microphone: permResult.microphone,
          camera: permResult.camera,
        });
        
        // Small delay to ensure permissions are fully processed
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Now enumerate devices to check what's available
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      const videoInputs = devices.filter(d => d.kind === 'videoinput');
      console.log('📱 Available audio devices:', audioInputs.length);
      console.log('📱 Available video devices:', videoInputs.length);
      audioInputs.forEach((d, i) => console.log('  Audio ' + i + ': ' + (d.label || 'unnamed')));

      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: audioOnly ? false : {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
      };

      console.log('📱 Requesting getUserMedia with constraints:', JSON.stringify(constraints));
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      console.log('📱 Got stream with', this.localStream.getTracks().length, 'tracks');
      
      // Verify and enable all tracks
      this.localStream.getTracks().forEach((track, i) => {
        track.enabled = true;
        console.log('📱 Track ' + i + ' [' + track.kind + ']:', {
          id: track.id.substring(0, 8),
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        });
        
        if (track.kind === 'audio') {
          if (track.muted) {
            console.error('⚠️ AUDIO TRACK IS MUTED - Check system settings!');
          }
          if (track.readyState !== 'live') {
            console.error('⚠️ AUDIO TRACK NOT LIVE:', track.readyState);
          }
        }
      });
      
      const audioTracks = this.localStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio tracks available');
      }
      
      // Start monitoring local audio levels
      this.startAudioMonitor(this.localStream, 'LOCAL');
      
      console.log('✅ Local stream ready');
      return this.localStream;
    } catch (error: any) {
      console.error('❌ Failed to get local stream:', error);
      console.error('❌ Error name:', error.name);
      console.error('❌ Error message:', error.message);
      
      // If video failed but audio might work, try audio-only
      if (!audioOnly && (error.name === 'NotFoundError' || error.name === 'NotAllowedError' || error.name === 'NotReadableError')) {
        console.log('📱 Video failed, trying audio-only fallback...');
        try {
          // On native, request just audio permission
          if (isNative) {
            const audioPermResult = await requestCallPermissions(false);
            if (!audioPermResult.microphone) {
              throw new Error(getPermissionErrorMessage(error));
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          const audioOnlyConstraints: MediaStreamConstraints = {
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          };
          this.localStream = await navigator.mediaDevices.getUserMedia(audioOnlyConstraints);
          console.log('✅ Audio-only stream ready (no camera available)');
          
          this.localStream.getTracks().forEach((track, i) => {
            track.enabled = true;
            console.log('📱 Track ' + i + ' [' + track.kind + ']:', {
              id: track.id.substring(0, 8),
              label: track.label,
              enabled: track.enabled,
              readyState: track.readyState,
            });
          });
          
          this.startAudioMonitor(this.localStream, 'LOCAL');
          return this.localStream;
        } catch (audioError: any) {
          console.error('❌ Audio-only fallback also failed:', audioError);
          throw new Error(getPermissionErrorMessage(audioError));
        }
      }
      
      // Return user-friendly error message
      throw new Error(getPermissionErrorMessage(error));
    }
  }

  /**
   * Monitor audio levels to verify audio is being captured/received
   */
  private startAudioMonitor(stream: MediaStream, label: string): void {
    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      analyser.fftSize = 256;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      let silentCount = 0;
      let hasWarnedOnce = false;
      
      const checkLevel = () => {
        if (!stream.active) return;
        
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        
        if (avg > 5) {
          // Only log occasionally when audio is detected
          if (silentCount > 0) {
            console.log('✅ ' + label + ' audio detected');
          }
          silentCount = 0;
          hasWarnedOnce = false;
        } else {
          silentCount++;
          // Only warn once after 10 seconds of silence
          if (silentCount === 5 && !hasWarnedOnce) {
            console.warn('⚠️ ' + label + ' audio appears silent - this is normal if no one is speaking');
            hasWarnedOnce = true;
          }
        }
      };
      
      // Check every 2 seconds
      const interval = setInterval(checkLevel, 2000);
      
      // Store for cleanup
      if (label === 'LOCAL') {
        this.audioMonitorInterval = interval;
      }
    } catch (e) {
      // Silently ignore audio monitor errors
    }
  }

  /**
   * Create a call (initiator/caller)
   */
  createCall(
    callId: string,
    audioOnly: boolean = false,
    onSignal: (signal: any) => void,
    onIceCandidate?: (candidate: any) => void
  ): SimplePeer.Instance {
    if (!this.localStream) {
      throw new Error('Local stream not initialized');
    }

    console.log('========================================');
    console.log('📞 CREATING CALL (Initiator)');
    console.log('📞 Call ID:', callId);
    console.log('📞 Audio only:', audioOnly);
    console.log('========================================');
    
    // Log the stream we're about to send
    console.log('📞 Stream to send:', {
      id: this.localStream.id,
      active: this.localStream.active,
      tracks: this.localStream.getTracks().map(t => ({
        kind: t.kind,
        enabled: t.enabled,
        muted: t.muted,
        readyState: t.readyState,
      })),
    });

    const iceServers = getIceServers();

    const peer = new SimplePeer({
      initiator: true,
      stream: this.localStream, // Use original stream directly
      trickle: true,
      config: {
        iceServers,
        iceCandidatePoolSize: 10,
      },
    });

    this.setupPeerHandlers(peer, callId, onSignal, onIceCandidate);
    this.peers.set(callId, peer);

    return peer;
  }

  /**
   * Answer a call (receiver/callee)
   */
  answerCall(
    callId: string,
    audioOnly: boolean = false,
    onSignal: (signal: any) => void,
    onIceCandidate?: (candidate: any) => void
  ): SimplePeer.Instance {
    if (!this.localStream) {
      throw new Error('Local stream not initialized');
    }

    console.log('========================================');
    console.log('📞 ANSWERING CALL (Receiver)');
    console.log('📞 Call ID:', callId);
    console.log('========================================');
    
    console.log('📞 Stream to send:', {
      id: this.localStream.id,
      active: this.localStream.active,
      tracks: this.localStream.getTracks().map(t => ({
        kind: t.kind,
        enabled: t.enabled,
        muted: t.muted,
        readyState: t.readyState,
      })),
    });

    const iceServers = getIceServers();

    const peer = new SimplePeer({
      initiator: false,
      stream: this.localStream, // Use original stream directly
      trickle: true,
      config: {
        iceServers,
        iceCandidatePoolSize: 10,
      },
    });

    this.setupPeerHandlers(peer, callId, onSignal, onIceCandidate);
    this.peers.set(callId, peer);
    
    // Process any ICE candidates that arrived before peer was created
    // This is especially important for the callee who receives candidates during ringing
    this.processQueuedCandidates(callId);

    return peer;
  }

  /**
   * Setup peer connection event handlers
   */
  private setupPeerHandlers(
    peer: SimplePeer.Instance,
    callId: string,
    onSignal: (signal: any) => void,
    onIceCandidate?: (candidate: any) => void
  ): void {
    
    // Handle signaling data
    peer.on('signal', (signal) => {
      console.log('📤 SIGNAL:', signal.type || 'candidate');
      
      // Log SDP details for debugging
      if (signal.sdp) {
        const lines = signal.sdp.split('\n');
        const audioLines = lines.filter((l: string) => l.includes('audio') || l.includes('opus'));
        console.log('📤 SDP has audio:', audioLines.length > 0);
      }
      
      onSignal(signal);
    });

    // Handle incoming remote stream - THIS IS CRITICAL
    peer.on('stream', (stream) => {
      console.log('========================================');
      console.log('📥 REMOTE STREAM RECEIVED');
      console.log('========================================');
      console.log('📥 Stream ID:', stream.id);
      console.log('📥 Stream active:', stream.active);
      
      const tracks = stream.getTracks();
      console.log('📥 Tracks received:', tracks.length);
      
      tracks.forEach((track, i) => {
        console.log('📥 Track ' + i + ' [' + track.kind + ']:', {
          id: track.id.substring(0, 8),
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        });
        
        // Force enable
        track.enabled = true;
        
        if (track.kind === 'audio') {
          if (track.muted) {
            console.error('⚠️ REMOTE AUDIO IS MUTED AT SOURCE');
          }
          if (track.readyState !== 'live') {
            console.error('⚠️ REMOTE AUDIO NOT LIVE:', track.readyState);
          }
        }
      });
      
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        console.error('❌ NO AUDIO TRACKS IN REMOTE STREAM!');
        console.error('❌ The other user may not be sending audio');
      } else {
        console.log('✅ Remote stream has', audioTracks.length, 'audio track(s)');
        // Start monitoring remote audio
        this.startAudioMonitor(stream, 'REMOTE');
      }
      
      console.log('========================================');
      
      // Notify handlers - pass callId as both callId and peerId for compatibility
      this.onStreamHandlers.forEach((handler) => handler(stream, callId, callId));
    });

    // Handle connection
    peer.on('connect', () => {
      console.log('========================================');
      console.log('✅ PEER CONNECTED');
      console.log('========================================');
      this.onConnectionStateHandlers.forEach(h => h('connected', callId));
    });

    // Handle errors
    peer.on('error', (error) => {
      console.error('❌ PEER ERROR:', error.message);
      this.onConnectionStateHandlers.forEach(h => h('error', callId));
      this.cleanupPeer(callId);
      this.onCallEndHandlers.forEach((handler) => handler(callId));
    });

    // Handle close
    peer.on('close', () => {
      console.log('📴 PEER CLOSED');
      this.onConnectionStateHandlers.forEach(h => h('closed', callId));
      this.cleanupPeer(callId);
    });

    // Access RTCPeerConnection for detailed debugging
    // @ts-ignore
    const pc = peer._pc as RTCPeerConnection;
    if (pc) {
      pc.oniceconnectionstatechange = () => {
        console.log('🧊 ICE state:', pc.iceConnectionState);
        this.onConnectionStateHandlers.forEach(h => h(pc.iceConnectionState, callId));
        
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          console.log('✅ ICE CONNECTED - Checking stats...');
          this.logStats(pc);
        }
        
        if (pc.iceConnectionState === 'failed') {
          console.error('❌ ICE FAILED - NAT/firewall issue');
        }
      };
      
      pc.onconnectionstatechange = () => {
        console.log('🔗 Connection state:', pc.connectionState);
      };
      
      // CRITICAL: Capture stream from ontrack since SimplePeer's stream event may not fire
      const remoteStream = new MediaStream();
      let hasNotifiedStream = false;
      
      pc.ontrack = (event) => {
        console.log('========================================');
        console.log('📥 RTC ontrack:', event.track.kind);
        console.log('📥 Track ID:', event.track.id);
        console.log('📥 Track enabled:', event.track.enabled);
        console.log('📥 Track muted:', event.track.muted);
        console.log('📥 Track readyState:', event.track.readyState);
        console.log('📥 Event streams:', event.streams.length);
        console.log('========================================');
        
        // Use the stream from the event if available, otherwise build our own
        let streamToUse: MediaStream;
        
        if (event.streams && event.streams.length > 0) {
          streamToUse = event.streams[0];
          console.log('📥 Using stream from event:', streamToUse.id);
        } else {
          // Add track to our manual stream
          event.track.enabled = true;
          remoteStream.addTrack(event.track);
          streamToUse = remoteStream;
          console.log('📥 Added track to manual stream');
        }
        
        // Notify handlers about the stream (debounce to avoid multiple notifications)
        if (!hasNotifiedStream && streamToUse.getTracks().length > 0) {
          hasNotifiedStream = true;
          
          console.log('========================================');
          console.log('📥 NOTIFYING HANDLERS OF REMOTE STREAM');
          console.log('📥 Stream ID:', streamToUse.id);
          console.log('📥 Stream tracks:', streamToUse.getTracks().length);
          streamToUse.getTracks().forEach((t, i) => {
            console.log('📥 Track', i, t.kind, '- enabled:', t.enabled, 'muted:', t.muted);
          });
          console.log('========================================');
          
          // Start audio monitoring
          const audioTracks = streamToUse.getAudioTracks();
          if (audioTracks.length > 0) {
            this.startAudioMonitor(streamToUse, 'REMOTE');
          }
          
          // Notify all handlers - pass callId as both callId and peerId
          this.onStreamHandlers.forEach((handler) => handler(streamToUse, callId, callId));
        }
      };
    }
  }

  /**
   * Log connection statistics
   */
  private async logStats(pc: RTCPeerConnection): Promise<void> {
    try {
      const stats = await pc.getStats();
      let inboundAudio = false;
      let outboundAudio = false;
      
      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          inboundAudio = true;
          console.log('📊 INBOUND AUDIO:', {
            packetsReceived: report.packetsReceived,
            bytesReceived: report.bytesReceived,
            packetsLost: report.packetsLost,
          });
        }
        if (report.type === 'outbound-rtp' && report.kind === 'audio') {
          outboundAudio = true;
          console.log('📊 OUTBOUND AUDIO:', {
            packetsSent: report.packetsSent,
            bytesSent: report.bytesSent,
          });
        }
      });
      
      if (!inboundAudio) {
        console.warn('⚠️ No inbound audio stats - not receiving audio');
      }
      if (!outboundAudio) {
        console.warn('⚠️ No outbound audio stats - not sending audio');
      }
    } catch (e) {
      console.warn('Could not get stats:', e);
    }
  }

  /**
   * Clean up peer
   */
  private cleanupPeer(callId: string): void {
    const peer = this.peers.get(callId);
    if (peer) {
      this.peers.delete(callId);
      peer.removeAllListeners();
      if (!peer.destroyed) {
        peer.destroy();
      }
    }
  }

  /**
   * Process incoming signal
   */
  processSignal(callId: string, signal: any): void {
    const peer = this.peers.get(callId);
    
    console.log('========================================');
    console.log('📥 PROCESSING SIGNAL');
    console.log('   Call ID:', callId);
    console.log('   Signal type:', signal?.type || 'candidate');
    console.log('   Has peer:', !!peer);
    console.log('   All peers:', [...this.peers.keys()]);
    console.log('========================================');
    
    if (peer) {
      if (signal.sdp) {
        const hasAudio = signal.sdp.includes('m=audio');
        const hasVideo = signal.sdp.includes('m=video');
        console.log('📥 SDP info:', { hasAudio, hasVideo, type: signal.type });
      }
      
      try {
        peer.signal(signal);
        console.log('📥 Signal processed successfully');
      } catch (error) {
        console.error('❌ Error processing signal:', error);
      }
    } else {
      console.error('⚠️ No peer found for callId:', callId);
      console.error('   Available peers:', [...this.peers.keys()]);
    }
  }

  /**
   * Add ICE candidate
   */
  addIceCandidate(callId: string, candidate: any): void {
    const peer = this.peers.get(callId);
    if (peer) {
      console.log('🧊 Adding ICE candidate to peer');
      try {
        peer.signal(candidate);
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    } else {
      // Queue the candidate for later when peer is created
      console.log('🧊 Queuing ICE candidate (peer not ready yet)');
      const queue = this.pendingCandidates.get(callId) || [];
      queue.push(candidate);
      this.pendingCandidates.set(callId, queue);
    }
  }

  /**
   * Process any queued ICE candidates for a call
   */
  private processQueuedCandidates(callId: string): void {
    const queue = this.pendingCandidates.get(callId);
    if (queue && queue.length > 0) {
      console.log('🧊 Processing', queue.length, 'queued ICE candidates');
      const peer = this.peers.get(callId);
      if (peer) {
        queue.forEach((candidate, i) => {
          try {
            console.log('🧊 Adding queued candidate', i + 1);
            peer.signal(candidate);
          } catch (error) {
            console.error('Error adding queued candidate:', error);
          }
        });
      }
      this.pendingCandidates.delete(callId);
    }
  }

  /**
   * End call
   */
  endCall(callId: string): void {
    console.log('📴 Ending call:', callId);
    const hadPeer = this.peers.has(callId);
    this.cleanupPeer(callId);
    if (hadPeer) {
      this.onCallEndHandlers.forEach((handler) => handler(callId));
    }
  }

  /**
   * Toggle audio
   */
  toggleAudio(): boolean {
    if (!this.localStream) return false;
    const audioTracks = this.localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      const enabled = !audioTracks[0].enabled;
      audioTracks.forEach((track) => {
        track.enabled = enabled;
      });
      console.log('🎤 Mic:', enabled ? 'ON' : 'OFF');
      return enabled;
    }
    return false;
  }

  /**
   * Toggle video
   */
  toggleVideo(): boolean {
    if (!this.localStream) return false;
    const videoTracks = this.localStream.getVideoTracks();
    if (videoTracks.length > 0) {
      const enabled = !videoTracks[0].enabled;
      videoTracks.forEach((track) => {
        track.enabled = enabled;
      });
      console.log('📹 Camera:', enabled ? 'ON' : 'OFF');
      return enabled;
    }
    return false;
  }

  /**
   * Get local stream
   */
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  /**
   * Stop local stream
   */
  stopLocalStream(): void {
    if (this.audioMonitorInterval) {
      clearInterval(this.audioMonitorInterval);
      this.audioMonitorInterval = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        track.stop();
      });
      this.localStream = null;
    }
  }

  /**
   * Register stream handler
   */
  onStream(handler: (stream: MediaStream, callId: string, peerId?: string) => void): () => void {
    this.onStreamHandlers.add(handler);
    return () => this.onStreamHandlers.delete(handler);
  }

  /**
   * Register call end handler
   */
  onCallEnd(handler: (callId: string) => void): () => void {
    this.onCallEndHandlers.add(handler);
    return () => this.onCallEndHandlers.delete(handler);
  }

  /**
   * Register connection state handler
   */
  onConnectionState(handler: (state: string, callId: string) => void): () => void {
    this.onConnectionStateHandlers.add(handler);
    return () => this.onConnectionStateHandlers.delete(handler);
  }

  /**
   * Cleanup all
   */
  cleanup(): void {
    console.log('🧹 Cleaning up WebRTC');
    this.peers.forEach((peer) => peer.destroy());
    this.peers.clear();
    this.stopLocalStream();
    this.onStreamHandlers.clear();
    this.onCallEndHandlers.clear();
    this.onConnectionStateHandlers.clear();
  }

  /**
   * Diagnostic: Test if we can capture and play audio locally
   */
  async testLocalAudio(): Promise<{ success: boolean; message: string }> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioTracks = stream.getAudioTracks();
      
      if (audioTracks.length === 0) {
        stream.getTracks().forEach(t => t.stop());
        return { success: false, message: 'No audio tracks available' };
      }
      
      const track = audioTracks[0];
      if (track.muted) {
        stream.getTracks().forEach(t => t.stop());
        return { success: false, message: 'Microphone is muted at system level' };
      }
      
      // Test audio level
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      analyser.fftSize = 256;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      // Wait and check levels
      await new Promise(resolve => setTimeout(resolve, 500));
      
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      
      audioContext.close();
      stream.getTracks().forEach(t => t.stop());
      
      if (avg > 0) {
        return { success: true, message: 'Microphone working (level: ' + avg.toFixed(1) + ')' };
      } else {
        return { success: false, message: 'Microphone not capturing audio (level: 0)' };
      }
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
}

export const webRTCService = new WebRTCService();
