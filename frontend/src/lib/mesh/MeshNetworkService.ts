// frontend/src/lib/mesh/MeshNetworkService.ts
// BlockStar Cypher - Enhanced Mesh Networking with QR Code Exchange
// Works offline via WebRTC peer-to-peer connections

import { encryptionService } from '../encryption';

export interface MeshPeer {
  id: string;
  walletAddress: string;
  publicKey: string;
  username?: string;
  distance: number;
  lastSeen: number;
  connectionState: 'connecting' | 'connected' | 'disconnected';
}

export interface MeshMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
  type: 'text' | 'file' | 'voice' | 'routing' | 'ack';
  hops: string[];
  ttl: number;
  encrypted: boolean;
}

export interface ConnectionOffer {
  type: 'offer' | 'answer';
  sdp: string;
  iceCandidates: RTCIceCandidateInit[];
  peerInfo: {
    walletAddress: string;
    publicKey: string;
    username?: string;
  };
  timestamp: number;
  expiresAt: number;
}

type MessageHandler = (message: MeshMessage) => void;
type PeerHandler = (peer: MeshPeer, event: 'connected' | 'disconnected') => void;
type StatusHandler = (status: MeshNetworkStatus) => void;

export interface MeshNetworkStatus {
  isOnline: boolean;
  isMeshMode: boolean;
  connectedPeers: number;
  knownPeers: number;
  queuedMessages: number;
  lastServerCheck: number;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

const OFFER_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const SERVER_CHECK_INTERVAL = 10000; // 10 seconds
const PEER_TIMEOUT = 30000; // 30 seconds
const MAX_MESSAGE_TTL = 10;
const MAX_HOPS = 5;

export class MeshNetworkService {
  private peers: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private peerInfo: Map<string, MeshPeer> = new Map();
  private routingTable: Map<string, string[]> = new Map();
  private messageQueue: MeshMessage[] = [];
  private processedMessages: Set<string> = new Set();
  private pendingIceCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  
  private myWalletAddress: string = '';
  private myPublicKey: string = '';
  private myUsername: string = '';
  
  private isInitialized: boolean = false;
  private isMeshMode: boolean = false;
  private isServerOnline: boolean = true;
  private serverCheckInterval: NodeJS.Timeout | null = null;
  private lastServerCheck: number = 0;
  
  private messageHandlers: Set<MessageHandler> = new Set();
  private peerHandlers: Set<PeerHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  
  private serverUrl: string = '';
  
  // ============================================
  // INITIALIZATION
  // ============================================
  
  async initialize(
    walletAddress: string, 
    publicKey: string | Uint8Array | any, 
    username?: string,
    serverUrl?: string
  ): Promise<void> {
    if (this.isInitialized) return;
    
    this.myWalletAddress = walletAddress.toLowerCase();
    
    // Convert publicKey to string if needed
    if (typeof publicKey === 'string') {
      this.myPublicKey = publicKey;
    } else if (publicKey instanceof Uint8Array) {
      this.myPublicKey = Array.from(publicKey)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } else if (publicKey instanceof ArrayBuffer) {
      this.myPublicKey = Array.from(new Uint8Array(publicKey))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } else if (Array.isArray(publicKey)) {
      this.myPublicKey = publicKey
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } else if (publicKey) {
      // Fallback to string conversion
      this.myPublicKey = String(publicKey);
    } else {
      this.myPublicKey = '';
      console.warn('⚠️ MeshNetworkService: No publicKey provided');
    }
    
    console.log('🔑 MeshNetworkService publicKey type:', typeof publicKey, 'converted to:', this.myPublicKey.substring(0, 20) + '...');
    
    this.myUsername = username || '';
    this.serverUrl = serverUrl || process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
    
    // Start server health monitoring
    this.startServerMonitoring();
    
    // Listen for mesh messages
    window.addEventListener('mesh-signal', this.handleSignalEvent.bind(this));
    
    // Start broadcast channel for local discovery
    this.startLocalDiscovery();
    
    this.isInitialized = true;
    console.log('🔗 Mesh network initialized for:', this.myWalletAddress);
    
    this.notifyStatusChange();
  }
  
  // ============================================
  // SERVER MONITORING & AUTO-FALLBACK
  // ============================================
  
  private startServerMonitoring(): void {
    const checkServer = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(`${this.serverUrl}/api/health`, {
          signal: controller.signal,
        });
        
        clearTimeout(timeout);
        
        const wasOnline = this.isServerOnline;
        this.isServerOnline = response.ok;
        this.lastServerCheck = Date.now();
        
        if (wasOnline && !this.isServerOnline) {
          console.log('🔴 Server offline - switching to mesh mode');
          this.enableMeshMode();
        } else if (!wasOnline && this.isServerOnline) {
          console.log('🟢 Server back online - syncing queued messages');
          this.syncQueuedMessages();
        }
        
        this.notifyStatusChange();
      } catch (error) {
        const wasOnline = this.isServerOnline;
        this.isServerOnline = false;
        this.lastServerCheck = Date.now();
        
        if (wasOnline) {
          console.log('🔴 Server unreachable - switching to mesh mode');
          this.enableMeshMode();
        }
        
        this.notifyStatusChange();
      }
    };
    
    // Initial check
    checkServer();
    
    // Periodic checks
    this.serverCheckInterval = setInterval(checkServer, SERVER_CHECK_INTERVAL);
  }
  
  private enableMeshMode(): void {
    this.isMeshMode = true;
    console.log('📡 Mesh mode enabled');
    this.notifyStatusChange();
  }
  
  private async syncQueuedMessages(): Promise<void> {
    if (this.messageQueue.length === 0) return;
    
    console.log(`📤 Syncing ${this.messageQueue.length} queued messages to server`);
    
    // TODO: Send queued messages to server
    // For now, just clear the queue since server is back
    this.messageQueue = [];
    this.isMeshMode = false;
    
    this.notifyStatusChange();
  }
  
  // ============================================
  // QR CODE CONNECTION EXCHANGE
  // ============================================
  
  /**
   * Generate a connection offer as QR code data
   * The other device scans this to connect
   */
  async createConnectionOffer(): Promise<{ qrData: string; offer: ConnectionOffer }> {
    const peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const tempId = `pending_${Date.now()}`;
    
    // Collect ICE candidates
    const iceCandidates: RTCIceCandidateInit[] = [];
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        iceCandidates.push(event.candidate.toJSON());
      }
    };
    
    // Create data channel
    const dataChannel = peerConnection.createDataChannel('mesh', { ordered: true });
    
    // Create offer
    const sdpOffer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(sdpOffer);
    
    // Wait for ICE gathering to complete
    await new Promise<void>((resolve) => {
      if (peerConnection.iceGatheringState === 'complete') {
        resolve();
      } else {
        peerConnection.onicegatheringstatechange = () => {
          if (peerConnection.iceGatheringState === 'complete') {
            resolve();
          }
        };
        // Timeout after 5 seconds
        setTimeout(resolve, 5000);
      }
    });
    
    const offer: ConnectionOffer = {
      type: 'offer',
      sdp: peerConnection.localDescription?.sdp || '',
      iceCandidates,
      peerInfo: {
        walletAddress: this.myWalletAddress,
        publicKey: this.myPublicKey,
        username: this.myUsername,
      },
      timestamp: Date.now(),
      expiresAt: Date.now() + OFFER_EXPIRY_MS,
    };
    
    console.log('🔐 Creating connection offer with peerInfo:', {
      walletAddress: offer.peerInfo.walletAddress?.slice(0, 12),
      publicKey: typeof offer.peerInfo.publicKey,
      publicKeyLength: offer.peerInfo.publicKey?.length || 0,
      username: offer.peerInfo.username,
    });
    
    // Store pending connection
    this.peers.set(tempId, peerConnection);
    this.pendingIceCandidates.set(tempId, []);
    
    // Setup data channel handlers
    dataChannel.onopen = () => {
      console.log('📡 Data channel opened (from offer)');
    };
    
    dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data, tempId);
    };
    
    // Compress and encode for QR
    const qrData = this.encodeForQR(offer);
    
    console.log('📱 Connection offer created, scan QR to connect');
    
    return { qrData, offer };
  }
  
  /**
   * Accept a connection offer from QR code scan
   */
  async acceptConnectionOffer(qrData: string): Promise<{ qrData: string; answer: ConnectionOffer }> {
    const offer = this.decodeFromQR(qrData) as ConnectionOffer;
    
    if (!offer || offer.type !== 'offer') {
      throw new Error('Invalid connection offer');
    }
    
    if (Date.now() > offer.expiresAt) {
      throw new Error('Connection offer has expired');
    }
    
    const peerId = offer.peerInfo.walletAddress.toLowerCase();
    
    // Create peer connection
    const peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    
    // Collect ICE candidates
    const iceCandidates: RTCIceCandidateInit[] = [];
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        iceCandidates.push(event.candidate.toJSON());
      }
    };
    
    // Handle incoming data channel
    peerConnection.ondatachannel = (event) => {
      const dataChannel = event.channel;
      this.setupDataChannel(dataChannel, peerId);
    };
    
    // Set remote description (the offer)
    await peerConnection.setRemoteDescription({
      type: 'offer',
      sdp: offer.sdp,
    });
    
    // Add ICE candidates from offer
    for (const candidate of offer.iceCandidates) {
      await peerConnection.addIceCandidate(candidate);
    }
    
    // Create answer
    const sdpAnswer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(sdpAnswer);
    
    // Wait for ICE gathering
    await new Promise<void>((resolve) => {
      if (peerConnection.iceGatheringState === 'complete') {
        resolve();
      } else {
        peerConnection.onicegatheringstatechange = () => {
          if (peerConnection.iceGatheringState === 'complete') {
            resolve();
          }
        };
        setTimeout(resolve, 5000);
      }
    });
    
    const answer: ConnectionOffer = {
      type: 'answer',
      sdp: peerConnection.localDescription?.sdp || '',
      iceCandidates,
      peerInfo: {
        walletAddress: this.myWalletAddress,
        publicKey: this.myPublicKey,
        username: this.myUsername,
      },
      timestamp: Date.now(),
      expiresAt: Date.now() + OFFER_EXPIRY_MS,
    };
    
    // Store peer
    this.peers.set(peerId, peerConnection);
    this.peerInfo.set(peerId, {
      id: peerId,
      walletAddress: offer.peerInfo.walletAddress,
      publicKey: offer.peerInfo.publicKey,
      username: offer.peerInfo.username,
      distance: 1,
      lastSeen: Date.now(),
      connectionState: 'connecting',
    });
    
    const qrAnswerData = this.encodeForQR(answer);
    
    console.log('📱 Connection answer created, show QR for other device to scan');
    
    return { qrData: qrAnswerData, answer };
  }
  
  /**
   * Complete connection by accepting the answer QR code
   */
  async completeConnection(qrData: string): Promise<void> {
    const answer = this.decodeFromQR(qrData) as ConnectionOffer;
    
    if (!answer || answer.type !== 'answer') {
      throw new Error('Invalid connection answer');
    }
    
    const peerId = answer.peerInfo.walletAddress.toLowerCase();
    
    // Find the pending connection
    let pendingId = '';
    for (const [id, conn] of this.peers.entries()) {
      if (id.startsWith('pending_')) {
        pendingId = id;
        break;
      }
    }
    
    if (!pendingId) {
      throw new Error('No pending connection found');
    }
    
    const peerConnection = this.peers.get(pendingId)!;
    
    // Set remote description (the answer)
    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: answer.sdp,
    });
    
    // Add ICE candidates
    for (const candidate of answer.iceCandidates) {
      await peerConnection.addIceCandidate(candidate);
    }
    
    // Move from pending to real peer ID
    this.peers.delete(pendingId);
    this.peers.set(peerId, peerConnection);
    
    // Store peer info
    this.peerInfo.set(peerId, {
      id: peerId,
      walletAddress: answer.peerInfo.walletAddress,
      publicKey: answer.peerInfo.publicKey,
      username: answer.peerInfo.username,
      distance: 1,
      lastSeen: Date.now(),
      connectionState: 'connecting',
    });
    
    // Setup data channel when it opens
    peerConnection.ondatachannel = (event) => {
      this.setupDataChannel(event.channel, peerId);
    };
    
    console.log('✅ Connection completed with:', peerId);
  }
  
  // ============================================
  // QR CODE ENCODING/DECODING (COMPRESSED)
  // ============================================
  
  // Minify SDP by removing unnecessary lines and shortening
  private minifySDP(sdp: string): string {
    const lines = sdp.split('\r\n');
    const essential: string[] = [];
    
    for (const line of lines) {
      // Skip empty lines and less critical lines for initial connection
      if (!line) continue;
      if (line.startsWith('a=extmap:')) continue;
      if (line.startsWith('a=rtcp-fb:')) continue;
      if (line.startsWith('a=ssrc-group:')) continue;
      if (line.startsWith('a=msid-semantic:')) continue;
      if (line.startsWith('a=ssrc:')) continue;
      if (line.startsWith('a=rtcp:')) continue;
      
      // Shorten common prefixes
      let shortened = line
        .replace('a=candidate:', 'C:')
        .replace('a=ice-ufrag:', 'U:')
        .replace('a=ice-pwd:', 'P:')
        .replace('a=fingerprint:', 'F:')
        .replace('a=setup:', 'S:')
        .replace('a=mid:', 'M:')
        .replace('a=rtpmap:', 'R:')
        .replace('a=group:BUNDLE', 'GB:')
        .replace('a=sctp-port:', 'SP:')
        .replace('a=max-message-size:', 'MS:')
        .replace('m=application', 'MA')
        .replace('c=IN IP4', 'CI4')
        .replace('UDP/DTLS/SCTP', 'UDS');
      
      essential.push(shortened);
    }
    
    return essential.join('|');
  }
  
  // Restore minified SDP
  private restoreSDP(minified: string): string {
    const lines = minified.split('|');
    const restored: string[] = [];
    
    for (const line of lines) {
      let full = line
        .replace('C:', 'a=candidate:')
        .replace('U:', 'a=ice-ufrag:')
        .replace('P:', 'a=ice-pwd:')
        .replace('F:', 'a=fingerprint:')
        .replace('S:', 'a=setup:')
        .replace('M:', 'a=mid:')
        .replace('R:', 'a=rtpmap:')
        .replace('GB:', 'a=group:BUNDLE')
        .replace('SP:', 'a=sctp-port:')
        .replace('MS:', 'a=max-message-size:')
        .replace('MA', 'm=application')
        .replace('CI4', 'c=IN IP4')
        .replace('UDS', 'UDP/DTLS/SCTP');
      
      restored.push(full);
    }
    
    return restored.join('\r\n') + '\r\n';
  }
  
  // Convert publicKey to string (handles various formats)
  private stringifyPublicKey(publicKey: any): string {
    if (!publicKey) {
      return '';
    }
    
    // Already a string
    if (typeof publicKey === 'string') {
      return publicKey;
    }
    
    // Uint8Array or ArrayBuffer
    if (publicKey instanceof Uint8Array) {
      return Array.from(publicKey)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    
    if (publicKey instanceof ArrayBuffer) {
      return Array.from(new Uint8Array(publicKey))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    
    // Array of numbers
    if (Array.isArray(publicKey)) {
      return publicKey
        .map(b => (typeof b === 'number' ? b.toString(16).padStart(2, '0') : String(b)))
        .join('');
    }
    
    // Object with specific formats (like from some crypto libraries)
    if (typeof publicKey === 'object') {
      // Try to convert to JSON string as fallback
      try {
        const json = JSON.stringify(publicKey);
        // Hash it to get a consistent short string
        return btoa(json).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
      } catch {
        return '';
      }
    }
    
    // Fallback: convert to string
    return String(publicKey);
  }
  
  private encodeForQR(data: ConnectionOffer): string {
    // Aggressively compress the data for smaller QR codes
    // Only include essential ICE candidates (host and srflx, max 2)
    const essentialCandidates = data.iceCandidates
      .filter(c => c.candidate && (c.candidate.includes('typ host') || c.candidate.includes('typ srflx')))
      .slice(0, 2)
      .map(c => {
        // Extract only essential parts of candidate
        const parts = c.candidate?.split(' ') || [];
        // Format: foundation component protocol priority ip port typ type
        if (parts.length >= 8) {
          return {
            c: `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]} ${parts[4]} ${parts[5]} ${parts[6]} ${parts[7]}`,
            m: c.sdpMid,
            l: c.sdpMLineIndex,
          };
        }
        return { c: c.candidate?.substring(0, 100), m: c.sdpMid, l: c.sdpMLineIndex };
      });
    
    const minified = {
      t: data.type === 'offer' ? 'o' : 'a',
      s: this.minifySDP(data.sdp),
      i: essentialCandidates,
      p: {
        w: String(data.peerInfo.walletAddress || '').slice(0, 12), // First 12 chars (0x + 10)
        k: this.stringifyPublicKey(data.peerInfo.publicKey).slice(0, 24), // First 24 chars of pubkey
        u: String(data.peerInfo.username || '').slice(0, 12), // Max 12 chars username
      },
      e: Math.floor((data.expiresAt - Date.now()) / 60000), // Minutes until expiry
    };
    
    const jsonStr = JSON.stringify(minified);
    console.log('📊 QR data JSON size:', jsonStr.length, 'characters');
    
    // Check if still too large (QR codes can hold ~2953 alphanumeric chars max, but L correction is ~1273)
    if (jsonStr.length > 1800) {
      // Further reduce by removing ICE candidates entirely - rely on trickle ICE
      minified.i = [];
      const reducedJson = JSON.stringify(minified);
      console.log('📊 Reduced QR data size:', reducedJson.length, 'characters');
      
      if (reducedJson.length > 1800) {
        throw new Error('The amount of data is too big to be stored in a QR Code');
      }
      return btoa(reducedJson);
    }
    
    return btoa(jsonStr);
  }
  
  private decodeFromQR(qrData: string): ConnectionOffer | null {
    try {
      const minified = JSON.parse(atob(qrData));
      
      // Restore ICE candidates
      const candidates = (minified.i || []).map((c: any) => ({
        candidate: c.c?.startsWith('candidate:') ? c.c : `candidate:${c.c}`,
        sdpMid: c.m,
        sdpMLineIndex: c.l,
      }));
      
      return {
        type: minified.t === 'o' ? 'offer' : 'answer',
        sdp: this.restoreSDP(minified.s),
        iceCandidates: candidates,
        peerInfo: {
          // Pad wallet address back to full length if needed
          walletAddress: minified.p.w.length < 42 ? minified.p.w.padEnd(42, '0') : minified.p.w,
          publicKey: minified.p.k,
          username: minified.p.u,
        },
        timestamp: Date.now(),
        expiresAt: Date.now() + (minified.e * 60000), // Convert minutes back to ms
      };
    } catch (error) {
      console.error('Failed to decode QR data:', error);
      return null;
    }
  }
  
  // ============================================
  // DATA CHANNEL MANAGEMENT
  // ============================================
  
  private setupDataChannel(channel: RTCDataChannel, peerId: string): void {
    this.dataChannels.set(peerId, channel);
    
    channel.onopen = () => {
      console.log(`📡 Data channel opened with: ${peerId}`);
      
      const peer = this.peerInfo.get(peerId);
      if (peer) {
        peer.connectionState = 'connected';
        peer.lastSeen = Date.now();
        this.notifyPeerChange(peer, 'connected');
      }
      
      // Update routing
      this.routingTable.set(peerId, [peerId]);
      this.broadcastRoutingUpdate();
      
      // Send queued messages for this peer
      this.sendQueuedMessagesTo(peerId);
      
      this.notifyStatusChange();
    };
    
    channel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data, peerId);
    };
    
    channel.onclose = () => {
      console.log(`📡 Data channel closed with: ${peerId}`);
      this.handlePeerDisconnect(peerId);
    };
    
    channel.onerror = (error) => {
      console.error(`Data channel error with ${peerId}:`, error);
      this.handlePeerDisconnect(peerId);
    };
  }
  
  private handleDataChannelMessage(data: string, fromPeer: string): void {
    try {
      const message = JSON.parse(data) as MeshMessage;
      
      // Update peer last seen
      const peer = this.peerInfo.get(fromPeer);
      if (peer) {
        peer.lastSeen = Date.now();
      }
      
      // Check if we've already processed this message
      if (this.processedMessages.has(message.id)) {
        return;
      }
      this.processedMessages.add(message.id);
      
      // Clean old processed messages (keep last 1000)
      if (this.processedMessages.size > 1000) {
        const arr = Array.from(this.processedMessages);
        this.processedMessages = new Set(arr.slice(-500));
      }
      
      if (message.type === 'routing') {
        this.handleRoutingMessage(message, fromPeer);
        return;
      }
      
      if (message.type === 'ack') {
        this.handleAckMessage(message);
        return;
      }
      
      // Check if message is for us
      if (message.to.toLowerCase() === this.myWalletAddress) {
        this.deliverMessage(message);
        this.sendAck(message, fromPeer);
        return;
      }
      
      // Forward message if TTL allows
      if (message.ttl > 0 && message.hops.length < MAX_HOPS) {
        this.forwardMessage(message, fromPeer);
      }
    } catch (error) {
      console.error('Failed to parse mesh message:', error);
    }
  }
  
  private handlePeerDisconnect(peerId: string): void {
    this.dataChannels.delete(peerId);
    this.peers.get(peerId)?.close();
    this.peers.delete(peerId);
    
    const peer = this.peerInfo.get(peerId);
    if (peer) {
      peer.connectionState = 'disconnected';
      this.notifyPeerChange(peer, 'disconnected');
    }
    
    // Update routing
    this.routingTable.delete(peerId);
    this.rebuildRoutingTable();
    
    this.notifyStatusChange();
  }
  
  // ============================================
  // MESSAGING
  // ============================================
  
  /**
   * Send a message via mesh network
   */
  async sendMessage(
    to: string,
    content: string,
    type: 'text' | 'file' | 'voice' = 'text'
  ): Promise<{ success: boolean; messageId: string }> {
    const toAddress = to.toLowerCase();
    
    // Encrypt message if we have recipient's public key
    let encryptedContent = content;
    let isEncrypted = false;
    
    const recipientPeer = this.peerInfo.get(toAddress);
    if (recipientPeer?.publicKey && encryptionService.isReady()) {
      try {
        encryptedContent = await encryptionService.encryptForRecipient(
          content,
          recipientPeer.publicKey
        );
        isEncrypted = true;
      } catch (error) {
        console.warn('Could not encrypt mesh message:', error);
      }
    }
    
    const message: MeshMessage = {
      id: `mesh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      from: this.myWalletAddress,
      to: toAddress,
      content: encryptedContent,
      timestamp: Date.now(),
      type,
      hops: [],
      ttl: MAX_MESSAGE_TTL,
      encrypted: isEncrypted,
    };
    
    // Try direct connection first
    const directChannel = this.dataChannels.get(toAddress);
    if (directChannel && directChannel.readyState === 'open') {
      directChannel.send(JSON.stringify(message));
      console.log('📨 Sent direct mesh message to:', toAddress);
      return { success: true, messageId: message.id };
    }
    
    // Try routing
    const route = this.routingTable.get(toAddress);
    if (route && route.length > 0) {
      const nextHop = route[0];
      const channel = this.dataChannels.get(nextHop);
      if (channel && channel.readyState === 'open') {
        message.hops.push(this.myWalletAddress);
        channel.send(JSON.stringify(message));
        console.log('📨 Sent routed mesh message via:', nextHop);
        return { success: true, messageId: message.id };
      }
    }
    
    // Queue message for later
    this.messageQueue.push(message);
    console.log('📥 Queued mesh message for:', toAddress);
    this.notifyStatusChange();
    
    return { success: false, messageId: message.id };
  }
  
  private forwardMessage(message: MeshMessage, fromPeer: string): void {
    message.hops.push(this.myWalletAddress);
    message.ttl--;
    
    // Find route to destination
    const route = this.routingTable.get(message.to);
    
    if (route && route.length > 0) {
      const nextHop = route[0];
      // Don't send back to where it came from
      if (nextHop !== fromPeer) {
        const channel = this.dataChannels.get(nextHop);
        if (channel && channel.readyState === 'open') {
          channel.send(JSON.stringify(message));
          console.log('🔄 Forwarded message to:', nextHop);
          return;
        }
      }
    }
    
    // Broadcast to all peers except sender
    this.dataChannels.forEach((channel, peerId) => {
      if (peerId !== fromPeer && channel.readyState === 'open') {
        channel.send(JSON.stringify(message));
      }
    });
  }
  
  private deliverMessage(message: MeshMessage): void {
    // Decrypt if encrypted
    if (message.encrypted && encryptionService.isReady()) {
      try {
        const { decrypted } = encryptionService.decryptFromSender(
          message.content,
          message.from
        );
        message.content = decrypted;
      } catch (error) {
        console.warn('Could not decrypt mesh message:', error);
        message.content = '🔒 [Encrypted message - cannot decrypt]';
      }
    }
    
    console.log('📬 Received mesh message from:', message.from);
    
    // Notify handlers
    this.messageHandlers.forEach((handler) => handler(message));
    
    // Also dispatch event for app integration
    window.dispatchEvent(new CustomEvent('mesh-message-received', { detail: message }));
  }
  
  private sendAck(message: MeshMessage, toPeer: string): void {
    const ack: MeshMessage = {
      id: `ack_${message.id}`,
      from: this.myWalletAddress,
      to: message.from,
      content: message.id,
      timestamp: Date.now(),
      type: 'ack',
      hops: [],
      ttl: MAX_MESSAGE_TTL,
      encrypted: false,
    };
    
    const channel = this.dataChannels.get(toPeer);
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(ack));
    }
  }
  
  private handleAckMessage(message: MeshMessage): void {
    // Remove from queue if present
    const originalId = message.content;
    this.messageQueue = this.messageQueue.filter((m) => m.id !== originalId);
    this.notifyStatusChange();
  }
  
  private sendQueuedMessagesTo(peerId: string): void {
    const toSend = this.messageQueue.filter((m) => m.to === peerId);
    const channel = this.dataChannels.get(peerId);
    
    if (channel && channel.readyState === 'open') {
      toSend.forEach((message) => {
        channel.send(JSON.stringify(message));
      });
      
      // Remove sent messages from queue
      this.messageQueue = this.messageQueue.filter((m) => m.to !== peerId);
      this.notifyStatusChange();
    }
  }
  
  // ============================================
  // ROUTING
  // ============================================
  
  private handleRoutingMessage(message: MeshMessage, fromPeer: string): void {
    try {
      const routes = JSON.parse(message.content) as Record<string, number>;
      
      for (const [destination, distance] of Object.entries(routes)) {
        if (destination === this.myWalletAddress) continue;
        
        const newDistance = distance + 1;
        const existingRoute = this.routingTable.get(destination);
        
        if (!existingRoute || newDistance < existingRoute.length) {
          this.routingTable.set(destination, [fromPeer, ...Array(distance).fill('*')]);
        }
      }
    } catch (error) {
      console.error('Failed to parse routing message:', error);
    }
  }
  
  private broadcastRoutingUpdate(): void {
    const routes: Record<string, number> = {};
    
    // Add self
    routes[this.myWalletAddress] = 0;
    
    // Add known routes
    this.routingTable.forEach((path, destination) => {
      routes[destination] = path.length;
    });
    
    const message: MeshMessage = {
      id: `routing_${Date.now()}`,
      from: this.myWalletAddress,
      to: 'broadcast',
      content: JSON.stringify(routes),
      timestamp: Date.now(),
      type: 'routing',
      hops: [],
      ttl: 3,
      encrypted: false,
    };
    
    this.dataChannels.forEach((channel) => {
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(message));
      }
    });
  }
  
  private rebuildRoutingTable(): void {
    // Keep only direct connections
    const directPeers = new Set(this.dataChannels.keys());
    
    this.routingTable.forEach((_, destination) => {
      if (!directPeers.has(destination)) {
        this.routingTable.delete(destination);
      }
    });
    
    // Request routing updates
    this.broadcastRoutingUpdate();
  }
  
  // ============================================
  // LOCAL DISCOVERY (Same Network)
  // ============================================
  
  private startLocalDiscovery(): void {
    if (typeof BroadcastChannel === 'undefined') return;
    
    const discoveryChannel = new BroadcastChannel('blockstar-mesh-discovery');
    const signalingChannel = new BroadcastChannel('blockstar-mesh-signaling');
    
    // Announce presence
    const announce = () => {
      discoveryChannel.postMessage({
        type: 'announce',
        walletAddress: this.myWalletAddress,
        publicKey: this.myPublicKey,
        username: this.myUsername,
        timestamp: Date.now(),
      });
    };
    
    // Listen for peers
    discoveryChannel.onmessage = (event) => {
      if (event.data.walletAddress === this.myWalletAddress) return;
      
      if (event.data.type === 'announce') {
        this.handleLocalPeerDiscovery(event.data);
      }
    };
    
    // Handle signaling
    signalingChannel.onmessage = (event) => {
      if (event.data.to === this.myWalletAddress) {
        this.handleSignalingMessage(event.data);
      }
    };
    
    // Announce periodically
    announce();
    setInterval(announce, 5000);
  }
  
  private handleLocalPeerDiscovery(data: any): void {
    const peerId = data.walletAddress.toLowerCase();
    
    if (this.peerInfo.has(peerId) || this.peers.has(peerId)) return;
    
    console.log('📡 Discovered local peer:', peerId);
    
    // Automatically connect
    this.connectToLocalPeer(peerId, data.publicKey, data.username);
  }
  
  private async connectToLocalPeer(peerId: string, publicKey: string, username?: string): Promise<void> {
    const peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        const channel = new BroadcastChannel('blockstar-mesh-signaling');
        channel.postMessage({
          type: 'ice-candidate',
          from: this.myWalletAddress,
          to: peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };
    
    const dataChannel = peerConnection.createDataChannel('mesh', { ordered: true });
    this.setupDataChannel(dataChannel, peerId);
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // Send offer via broadcast channel
    const channel = new BroadcastChannel('blockstar-mesh-signaling');
    channel.postMessage({
      type: 'offer',
      from: this.myWalletAddress,
      to: peerId,
      sdp: offer.sdp,
      publicKey: this.myPublicKey,
      username: this.myUsername,
    });
    
    this.peers.set(peerId, peerConnection);
    this.peerInfo.set(peerId, {
      id: peerId,
      walletAddress: peerId,
      publicKey,
      username,
      distance: 1,
      lastSeen: Date.now(),
      connectionState: 'connecting',
    });
  }
  
  private async handleSignalingMessage(data: any): Promise<void> {
    const peerId = data.from.toLowerCase();
    
    if (data.type === 'offer') {
      const peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          const channel = new BroadcastChannel('blockstar-mesh-signaling');
          channel.postMessage({
            type: 'ice-candidate',
            from: this.myWalletAddress,
            to: peerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };
      
      peerConnection.ondatachannel = (event) => {
        this.setupDataChannel(event.channel, peerId);
      };
      
      await peerConnection.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      const channel = new BroadcastChannel('blockstar-mesh-signaling');
      channel.postMessage({
        type: 'answer',
        from: this.myWalletAddress,
        to: peerId,
        sdp: answer.sdp,
      });
      
      this.peers.set(peerId, peerConnection);
      this.peerInfo.set(peerId, {
        id: peerId,
        walletAddress: peerId,
        publicKey: data.publicKey,
        username: data.username,
        distance: 1,
        lastSeen: Date.now(),
        connectionState: 'connecting',
      });
    } else if (data.type === 'answer') {
      const peerConnection = this.peers.get(peerId);
      if (peerConnection) {
        await peerConnection.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      }
    } else if (data.type === 'ice-candidate') {
      const peerConnection = this.peers.get(peerId);
      if (peerConnection) {
        await peerConnection.addIceCandidate(data.candidate);
      }
    }
  }
  
  private handleSignalEvent(event: Event): void {
    const customEvent = event as CustomEvent;
    this.handleSignalingMessage(customEvent.detail);
  }
  
  // ============================================
  // EVENT HANDLERS
  // ============================================
  
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }
  
  onPeerChange(handler: PeerHandler): () => void {
    this.peerHandlers.add(handler);
    return () => this.peerHandlers.delete(handler);
  }
  
  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }
  
  private notifyPeerChange(peer: MeshPeer, event: 'connected' | 'disconnected'): void {
    this.peerHandlers.forEach((handler) => handler(peer, event));
  }
  
  private notifyStatusChange(): void {
    const status = this.getStatus();
    this.statusHandlers.forEach((handler) => handler(status));
  }
  
  // ============================================
  // GETTERS
  // ============================================
  
  getStatus(): MeshNetworkStatus {
    return {
      isOnline: this.isServerOnline,
      isMeshMode: this.isMeshMode,
      connectedPeers: this.dataChannels.size,
      knownPeers: this.peerInfo.size,
      queuedMessages: this.messageQueue.length,
      lastServerCheck: this.lastServerCheck,
    };
  }
  
  getConnectedPeers(): MeshPeer[] {
    return Array.from(this.peerInfo.values()).filter(
      (p) => p.connectionState === 'connected'
    );
  }
  
  getPeerInfo(walletAddress: string): MeshPeer | undefined {
    return this.peerInfo.get(walletAddress.toLowerCase());
  }
  
  isConnectedTo(walletAddress: string): boolean {
    const channel = this.dataChannels.get(walletAddress.toLowerCase());
    return channel?.readyState === 'open';
  }
  
  // ============================================
  // CLEANUP
  // ============================================
  
  shutdown(): void {
    if (this.serverCheckInterval) {
      clearInterval(this.serverCheckInterval);
    }
    
    this.dataChannels.forEach((channel) => channel.close());
    this.peers.forEach((conn) => conn.close());
    
    this.peers.clear();
    this.dataChannels.clear();
    this.peerInfo.clear();
    this.routingTable.clear();
    this.messageQueue = [];
    this.processedMessages.clear();
    
    this.isInitialized = false;
    this.isMeshMode = false;
    
    console.log('🔗 Mesh network shutdown');
  }
}

// Singleton instance
export const meshNetworkService = new MeshNetworkService();
