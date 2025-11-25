import SimplePeer from 'simple-peer';
import { WebRTCConnection } from '@/types';

export class WebRTCService {
  private peers: Map<string, SimplePeer.Instance> = new Map();
  private localStream: MediaStream | null = null;
  private onStreamHandlers: Set<(stream: MediaStream, callId: string) => void> = new Set();
  private onCallEndHandlers: Set<(callId: string) => void> = new Set();

  /**
   * Initialize local media stream
   */
  async initializeLocalStream(audioOnly: boolean = false): Promise<MediaStream> {
    try {
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

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // CRITICAL: Ensure all tracks are enabled
      this.localStream.getTracks().forEach(track => {
        track.enabled = true;
        console.log(`📡 Track ${track.kind}:`, {
          id: track.id,
          enabled: track.enabled,
          muted: track.muted,  // Read-only: indicates if source is providing data
          readyState: track.readyState
        });
        
        // IMPORTANT: track.muted = true means microphone is muted at OS/hardware level
        if (track.muted) {
          console.warn(`⚠️ ${track.kind} track is MUTED at system level!`);
          console.warn('Please check your system audio settings and unmute your microphone');
        }
      });
      
      return this.localStream;
    } catch (error) {
      console.error('Failed to get local stream:', error);
      throw new Error('Failed to access camera/microphone');
    }
  }

  /**
   * Create a peer connection (initiator)
   */
  createCall(
    callId: string,
    audioOnly: boolean = false,
    onSignal: (signal: any) => void,
    onIceCandidate: (candidate: any) => void
  ): SimplePeer.Instance {
    if (!this.localStream) {
      throw new Error('Local stream not initialized');
    }

    const peer = new SimplePeer({
      initiator: true,
      stream: this.localStream,
      trickle: true,
      config: {
        iceServers: [
          // Public STUN servers (free, reliable)
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          
          // Free public TURN servers (Open Relay Project by Metered)
          // These work for testing and small projects
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
          },
          
          // Add your own TURN server for production (see TURN-SERVER-SETUP.md)
          // {
          //   urls: 'turn:your-turn-server.com:3478',
          //   username: 'your-username',
          //   credential: 'your-password',
          // },
        ],
      },
    });

    this.setupPeerHandlers(peer, callId, onSignal, onIceCandidate);
    this.peers.set(callId, peer);

    return peer;
  }

  /**
   * Answer a call (receiver)
   */
  answerCall(
    callId: string,
    audioOnly: boolean = false,
    onSignal: (signal: any) => void,
    onIceCandidate: (candidate: any) => void
  ): SimplePeer.Instance {
    if (!this.localStream) {
      throw new Error('Local stream not initialized');
    }

    const peer = new SimplePeer({
      initiator: false,
      stream: this.localStream,
      trickle: true,
      config: {
        iceServers: [
          // Public STUN servers (free, reliable)
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          
          // Free public TURN servers (Open Relay Project by Metered)
          // These work for testing and small projects
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
          },
          
          // Add your own TURN server for production (see TURN-SERVER-SETUP.md)
          // {
          //   urls: 'turn:your-turn-server.com:3478',
          //   username: 'your-username',
          //   credential: 'your-password',
          // },
        ],
      },
    });

    this.setupPeerHandlers(peer, callId, onSignal, onIceCandidate);
    this.peers.set(callId, peer);

    return peer;
  }

  /**
   * Setup peer connection event handlers
   */
  private setupPeerHandlers(
    peer: SimplePeer.Instance,
    callId: string,
    onSignal: (signal: any) => void,
    onIceCandidate: (candidate: any) => void
  ): void {
    peer.on('signal', (signal) => {
      onSignal(signal);
    });

    peer.on('stream', (stream) => {
      this.onStreamHandlers.forEach((handler) => handler(stream, callId));
    });

    peer.on('icecandidate', (candidate) => {
      if (candidate) {
        onIceCandidate(candidate);
      }
    });

    peer.on('error', (error) => {
      console.error('Peer error:', error);
      // On error, notify handlers (which may update UI)
      // But don't send websocket event - let user decide to end
      this.cleanupPeer(callId);
      this.onCallEndHandlers.forEach((handler) => handler(callId));
    });

    peer.on('close', () => {
      console.log('Peer connection closed');
      // Just clean up locally, don't notify anyone
      // This is usually triggered by explicit endCall or remote end
      this.cleanupPeer(callId);
    });
  }

  /**
   * Clean up peer locally without notifying remote
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
    if (peer) {
      peer.signal(signal);
    }
  }

  /**
   * Add ICE candidate
   */
  addIceCandidate(callId: string, candidate: any): void {
    const peer = this.peers.get(callId);
    if (peer) {
      // If candidate is already wrapped, pass as-is; otherwise wrap it
      if (candidate.candidate !== undefined) {
        peer.signal(candidate);
      } else {
        peer.signal({ candidate });
      }
    }
  }

  /**
   * End a call (explicit end by user)
   */
  endCall(callId: string): void {
    const hadPeer = this.peers.has(callId);
    
    // Clean up the peer connection
    this.cleanupPeer(callId);

    // Only notify handlers if there was actually a peer to end
    // This prevents double-notifications
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
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
  }

  /**
   * Register stream handler
   */
  onStream(handler: (stream: MediaStream, callId: string) => void): () => void {
    this.onStreamHandlers.add(handler);
    
    return () => {
      this.onStreamHandlers.delete(handler);
    };
  }

  /**
   * Register call end handler
   */
  onCallEnd(handler: (callId: string) => void): () => void {
    this.onCallEndHandlers.add(handler);
    
    return () => {
      this.onCallEndHandlers.delete(handler);
    };
  }

  /**
   * Clean up all connections
   */
  cleanup(): void {
    this.peers.forEach((peer, callId) => {
      peer.destroy();
    });
    
    this.peers.clear();
    this.stopLocalStream();
    this.onStreamHandlers.clear();
    this.onCallEndHandlers.clear();
  }
}

export const webRTCService = new WebRTCService();
