// frontend/src/lib/mesh/MeshCallService.ts
// Integrates mesh networking with the call system
// Routes call signals through mesh when server is offline

import { meshNetworkService, MeshCallSignal } from './MeshNetworkService';
import { webSocketService } from '@/lib/websocket';
import { webRTCService } from '@/lib/webrtc';

type IncomingCallHandler = (data: {
  callId: string;
  callerId: string;
  callerName?: string;
  callerAvatar?: string;
  callType: 'audio' | 'video';
  offer: any;
  viaMesh: boolean;
}) => void;

type CallAnswerHandler = (data: {
  callId: string;
  answer: any;
  viaMesh: boolean;
}) => void;

type IceCandidateHandler = (data: {
  callId: string;
  candidate: any;
  viaMesh: boolean;
}) => void;

type CallEndedHandler = (data: {
  callId: string;
  viaMesh: boolean;
}) => void;

class MeshCallService {
  private incomingCallHandlers = new Set<IncomingCallHandler>();
  private callAnswerHandlers = new Set<CallAnswerHandler>();
  private iceCandidateHandlers = new Set<IceCandidateHandler>();
  private callEndedHandlers = new Set<CallEndedHandler>();
  private isInitialized = false;
  private currentCallId: string | null = null;
  private currentCallPeer: string | null = null;

  /**
   * Initialize the mesh call service
   * Call this once when the app starts
   */
  initialize(): void {
    if (this.isInitialized) return;

    console.log('📞 [MeshCallService] Initializing...');

    // Subscribe to mesh call signals
    meshNetworkService.onCallSignal((signal, fromAddress) => {
      this.handleMeshCallSignal(signal, fromAddress);
    });

    this.isInitialized = true;
    console.log('📞 [MeshCallService] Initialized');
  }

  /**
   * Handle incoming call signal from mesh
   */
  private handleMeshCallSignal(signal: MeshCallSignal, fromAddress: string): void {
    console.log('📞 [MeshCallService] Received signal:', signal.signalType, 'from:', fromAddress);

    switch (signal.signalType) {
      case 'offer':
        // Incoming call via mesh
        this.incomingCallHandlers.forEach(handler => handler({
          callId: signal.callId,
          callerId: fromAddress,
          callerName: signal.callerName,
          callerAvatar: signal.callerAvatar,
          callType: signal.callType || 'audio',
          offer: signal.sdp,
          viaMesh: true,
        }));
        break;

      case 'answer':
        // Call answered via mesh
        this.callAnswerHandlers.forEach(handler => handler({
          callId: signal.callId,
          answer: signal.sdp,
          viaMesh: true,
        }));
        break;

      case 'ice-candidate':
        // ICE candidate via mesh
        this.iceCandidateHandlers.forEach(handler => handler({
          callId: signal.callId,
          candidate: signal.candidate,
          viaMesh: true,
        }));
        break;

      case 'call-end':
      case 'call-decline':
        // Call ended via mesh
        this.callEndedHandlers.forEach(handler => handler({
          callId: signal.callId,
          viaMesh: true,
        }));
        break;
    }
  }

  /**
   * Initiate a call - uses mesh if server is offline and peer is reachable
   */
  async initiateCall(
    recipientAddress: string,
    callType: 'audio' | 'video',
    offer: any,
    callId: string,
    callerName?: string,
    callerAvatar?: string
  ): Promise<{ success: boolean; viaMesh: boolean; error?: string }> {
    const isServerOnline = webSocketService.isConnected();
    const canReachViaMesh = meshNetworkService.canReachPeerForCall(recipientAddress);

    console.log('📞 [MeshCallService] Initiating call:', {
      isServerOnline,
      canReachViaMesh,
      recipientAddress,
    });

    // Store current call info
    this.currentCallId = callId;
    this.currentCallPeer = recipientAddress;

    // Try server first if online
    if (isServerOnline) {
      try {
        webSocketService.initiateCall(recipientAddress, callType, offer, callId, callerName);
        console.log('📞 [MeshCallService] Call initiated via server');
        return { success: true, viaMesh: false };
      } catch (e) {
        console.error('📞 [MeshCallService] Server call failed:', e);
        // Fall through to try mesh
      }
    }

    // Try mesh if server unavailable
    if (canReachViaMesh) {
      const result = await meshNetworkService.sendCallOffer(
        recipientAddress,
        callId,
        offer,
        callType,
        callerName,
        callerAvatar
      );

      if (result.sent) {
        console.log('📞 [MeshCallService] Call initiated via mesh');
        return { success: true, viaMesh: true };
      }
    }

    return { 
      success: false, 
      viaMesh: false, 
      error: 'Cannot reach peer - no server connection and no mesh route' 
    };
  }

  /**
   * Answer a call - uses mesh if it came via mesh or server is offline
   */
  async answerCall(
    callId: string,
    answer: any,
    recipientAddress: string,
    viaMesh: boolean = false
  ): Promise<{ success: boolean; viaMesh: boolean; error?: string }> {
    const isServerOnline = webSocketService.isConnected();

    console.log('📞 [MeshCallService] Answering call:', {
      callId,
      viaMesh,
      isServerOnline,
    });

    // If call came via mesh or server is offline, respond via mesh
    if (viaMesh || !isServerOnline) {
      const canReachViaMesh = meshNetworkService.canReachPeerForCall(recipientAddress);
      
      if (canReachViaMesh) {
        const result = await meshNetworkService.sendCallAnswer(recipientAddress, callId, answer);
        if (result.sent) {
          console.log('📞 [MeshCallService] Answer sent via mesh');
          return { success: true, viaMesh: true };
        }
      }
      
      if (!isServerOnline) {
        return { success: false, viaMesh: true, error: 'Cannot reach peer via mesh' };
      }
    }

    // Use server
    try {
      webSocketService.answerCall(callId, answer);
      console.log('📞 [MeshCallService] Answer sent via server');
      return { success: true, viaMesh: false };
    } catch (e) {
      console.error('📞 [MeshCallService] Failed to send answer:', e);
      return { success: false, viaMesh: false, error: 'Failed to send answer' };
    }
  }

  /**
   * Send ICE candidate - uses mesh if call is via mesh or server offline
   */
  async sendIceCandidate(
    recipientAddress: string,
    candidate: any,
    callId: string,
    viaMesh: boolean = false
  ): Promise<void> {
    const isServerOnline = webSocketService.isConnected();

    // If mesh call or server offline, send via mesh
    if (viaMesh || !isServerOnline) {
      const canReachViaMesh = meshNetworkService.canReachPeerForCall(recipientAddress);
      
      if (canReachViaMesh) {
        await meshNetworkService.sendIceCandidate(recipientAddress, callId, candidate);
        return;
      }
    }

    // Use server
    if (isServerOnline) {
      webSocketService.sendIceCandidate(recipientAddress, candidate, callId);
    }
  }

  /**
   * End a call
   */
  async endCall(callId: string, recipientAddress?: string, viaMesh: boolean = false): Promise<void> {
    const isServerOnline = webSocketService.isConnected();
    const peer = recipientAddress || this.currentCallPeer;

    console.log('📞 [MeshCallService] Ending call:', callId);

    // Send end signal via mesh if needed
    if (peer && (viaMesh || !isServerOnline)) {
      const canReachViaMesh = meshNetworkService.canReachPeerForCall(peer);
      if (canReachViaMesh) {
        await meshNetworkService.sendCallEnd(peer, callId);
      }
    }

    // Also send via server if online
    if (isServerOnline) {
      webSocketService.endCall(callId);
    }

    // Clear current call
    if (this.currentCallId === callId) {
      this.currentCallId = null;
      this.currentCallPeer = null;
    }
  }

  // ============================================
  // EVENT SUBSCRIPTIONS
  // ============================================

  onIncomingCall(handler: IncomingCallHandler): () => void {
    this.incomingCallHandlers.add(handler);
    return () => this.incomingCallHandlers.delete(handler);
  }

  onCallAnswer(handler: CallAnswerHandler): () => void {
    this.callAnswerHandlers.add(handler);
    return () => this.callAnswerHandlers.delete(handler);
  }

  onIceCandidate(handler: IceCandidateHandler): () => void {
    this.iceCandidateHandlers.add(handler);
    return () => this.iceCandidateHandlers.delete(handler);
  }

  onCallEnded(handler: CallEndedHandler): () => void {
    this.callEndedHandlers.add(handler);
    return () => this.callEndedHandlers.delete(handler);
  }

  // ============================================
  // UTILITIES
  // ============================================

  /**
   * Check if we can make a call to a peer
   */
  canCallPeer(walletAddress: string): { canCall: boolean; viaMesh: boolean; viaServer: boolean } {
    const viaServer = webSocketService.isConnected();
    const viaMesh = meshNetworkService.canReachPeerForCall(walletAddress);

    return {
      canCall: viaServer || viaMesh,
      viaMesh,
      viaServer,
    };
  }

  /**
   * Get the current call state
   */
  getCurrentCall(): { callId: string | null; peer: string | null } {
    return {
      callId: this.currentCallId,
      peer: this.currentCallPeer,
    };
  }
}

// Export singleton instance
export const meshCallService = new MeshCallService();
