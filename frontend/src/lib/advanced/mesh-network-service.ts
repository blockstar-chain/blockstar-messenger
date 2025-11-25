import { MeshPeer, Message } from '@/types';

/**
 * Mesh Networking Service
 * Handles peer-to-peer mesh networking using WebRTC Data Channels
 * For true BLE/WiFi Direct, this needs native mobile implementation
 */

export class MeshNetworkService {
  private peers: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private discoveredPeers: Map<string, MeshPeer> = new Map();
  private messageQueue: Message[] = [];
  private routingTable: Map<string, string[]> = new Map(); // destination -> path
  private isInitialized: boolean = false;

  /**
   * Initialize mesh network
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Start peer discovery
      await this.startPeerDiscovery();
      
      this.isInitialized = true;
      console.log('Mesh network initialized');
    } catch (error) {
      console.error('Failed to initialize mesh network:', error);
    }
  }

  /**
   * Start discovering nearby peers
   */
  private async startPeerDiscovery(): Promise<void> {
    // In browser, we use WebRTC for mesh
    // For mobile, this would use BLE/WiFi Direct

    // Listen for peer announcements via broadcast channel
    const channel = new BroadcastChannel('mesh-discovery');
    
    channel.onmessage = (event) => {
      this.handlePeerDiscovery(event.data);
    };

    // Announce our presence
    setInterval(() => {
      channel.postMessage({
        type: 'peer-announcement',
        peerId: this.getLocalPeerId(),
        publicKey: this.getPublicKey(),
        timestamp: Date.now(),
      });
    }, 5000);
  }

  /**
   * Handle discovered peer
   */
  private async handlePeerDiscovery(data: any): Promise<void> {
    if (data.type !== 'peer-announcement' || data.peerId === this.getLocalPeerId()) {
      return;
    }

    const peer: MeshPeer = {
      id: data.peerId,
      address: data.peerId,
      publicKey: data.publicKey,
      distance: 1, // Direct peer
      lastSeen: Date.now(),
      available: true,
    };

    this.discoveredPeers.set(peer.id, peer);

    // Connect if not already connected
    if (!this.peers.has(peer.id)) {
      await this.connectToPeer(peer.id);
    }
  }

  /**
   * Connect to a peer
   */
  async connectToPeer(peerId: string): Promise<void> {
    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      });

      // Create data channel
      const dataChannel = peerConnection.createDataChannel('mesh', {
        ordered: true,
      });

      this.setupDataChannel(dataChannel, peerId);

      // Create and send offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      // Send offer via signaling (WebSocket or BroadcastChannel)
      this.sendSignal(peerId, {
        type: 'offer',
        offer,
        from: this.getLocalPeerId(),
      });

      this.peers.set(peerId, peerConnection);

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignal(peerId, {
            type: 'ice-candidate',
            candidate: event.candidate,
            from: this.getLocalPeerId(),
          });
        }
      };

      console.log(`Connected to peer: ${peerId}`);
    } catch (error) {
      console.error(`Failed to connect to peer ${peerId}:`, error);
    }
  }

  /**
   * Setup data channel for message routing
   */
  private setupDataChannel(channel: RTCDataChannel, peerId: string): void {
    this.dataChannels.set(peerId, channel);

    channel.onopen = () => {
      console.log(`Data channel opened with ${peerId}`);
      
      // Send routing table update
      this.broadcastRoutingUpdate();
    };

    channel.onmessage = (event) => {
      this.handleMeshMessage(JSON.parse(event.data), peerId);
    };

    channel.onclose = () => {
      console.log(`Data channel closed with ${peerId}`);
      this.dataChannels.delete(peerId);
      this.peers.delete(peerId);
      this.updateRoutingTable();
    };
  }

  /**
   * Handle incoming mesh message
   */
  private handleMeshMessage(data: any, fromPeer: string): void {
    switch (data.type) {
      case 'message':
        this.handleRelayedMessage(data.message, fromPeer);
        break;
      
      case 'routing-update':
        this.updateRoutingFromPeer(data.routes, fromPeer);
        break;
      
      case 'peer-list':
        this.updatePeerList(data.peers);
        break;
    }
  }

  /**
   * Send message via mesh network
   */
  async sendMessageViaMesh(message: Message, recipientId: string): Promise<boolean> {
    // Check if recipient is directly connected
    if (this.dataChannels.has(recipientId)) {
      const channel = this.dataChannels.get(recipientId)!;
      channel.send(JSON.stringify({
        type: 'message',
        message,
      }));
      return true;
    }

    // Find route to recipient
    const route = this.routingTable.get(recipientId);
    
    if (route && route.length > 0) {
      // Send to next hop
      const nextHop = route[0];
      const channel = this.dataChannels.get(nextHop);
      
      if (channel) {
        channel.send(JSON.stringify({
          type: 'message',
          message,
          destination: recipientId,
          path: route,
        }));
        return true;
      }
    }

    // No route found, queue for later
    this.messageQueue.push(message);
    return false;
  }

  /**
   * Handle relayed message
   */
  private handleRelayedMessage(message: Message, fromPeer: string): void {
    // Check if message is for us
    if (message.recipientId === this.getLocalPeerId()) {
      // Deliver message
      this.deliverMessage(message);
      return;
    }

    // Forward to next hop if we have a route
    const destination = Array.isArray(message.recipientId) 
      ? message.recipientId[0] 
      : message.recipientId;
    
    const route = this.routingTable.get(destination);
    
    if (route && route.length > 0) {
      const nextHop = route[0];
      const channel = this.dataChannels.get(nextHop);
      
      if (channel && nextHop !== fromPeer) {
        channel.send(JSON.stringify({
          type: 'message',
          message,
          destination,
        }));
      }
    }
  }

  /**
   * Update routing table from peer
   */
  private updateRoutingFromPeer(routes: any, fromPeer: string): void {
    for (const [destination, path] of Object.entries(routes) as [string, string[]][]) {
      // Add our peer to the path
      const newPath = [fromPeer, ...path];
      
      // Update if we don't have a route or new route is shorter
      const existingPath = this.routingTable.get(destination);
      if (!existingPath || newPath.length < existingPath.length) {
        this.routingTable.set(destination, newPath);
      }
    }
  }

  /**
   * Broadcast routing table update to all peers
   */
  private broadcastRoutingUpdate(): void {
    const routes: Record<string, string[]> = {};
    
    this.routingTable.forEach((path, destination) => {
      routes[destination] = path;
    });

    const message = JSON.stringify({
      type: 'routing-update',
      routes,
      from: this.getLocalPeerId(),
    });

    this.dataChannels.forEach((channel) => {
      if (channel.readyState === 'open') {
        channel.send(message);
      }
    });
  }

  /**
   * Update routing table
   */
  private updateRoutingTable(): void {
    // Rebuild routing table based on connected peers
    this.routingTable.clear();

    // Direct connections
    this.dataChannels.forEach((_, peerId) => {
      this.routingTable.set(peerId, [peerId]);
    });

    // Request routing updates from peers
    this.broadcastRoutingUpdate();
  }

  /**
   * Get list of connected peers
   */
  getConnectedPeers(): MeshPeer[] {
    return Array.from(this.discoveredPeers.values()).filter(
      (peer) => this.dataChannels.has(peer.id)
    );
  }

  /**
   * Get mesh network status
   */
  getNetworkStatus(): {
    connectedPeers: number;
    knownPeers: number;
    routes: number;
    queuedMessages: number;
  } {
    return {
      connectedPeers: this.dataChannels.size,
      knownPeers: this.discoveredPeers.size,
      routes: this.routingTable.size,
      queuedMessages: this.messageQueue.length,
    };
  }

  /**
   * Disconnect from peer
   */
  disconnectPeer(peerId: string): void {
    const channel = this.dataChannels.get(peerId);
    if (channel) {
      channel.close();
    }

    const connection = this.peers.get(peerId);
    if (connection) {
      connection.close();
    }

    this.dataChannels.delete(peerId);
    this.peers.delete(peerId);
    this.updateRoutingTable();
  }

  /**
   * Shutdown mesh network
   */
  shutdown(): void {
    this.peers.forEach((connection) => connection.close());
    this.dataChannels.forEach((channel) => channel.close());
    
    this.peers.clear();
    this.dataChannels.clear();
    this.discoveredPeers.clear();
    this.routingTable.clear();
    this.messageQueue = [];
    
    this.isInitialized = false;
  }

  // Helper methods
  private getLocalPeerId(): string {
    return localStorage.getItem('mesh-peer-id') || this.generatePeerId();
  }

  private generatePeerId(): string {
    const id = `peer_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('mesh-peer-id', id);
    return id;
  }

  private getPublicKey(): string {
    // Get from encryption service
    return '';
  }

  private sendSignal(peerId: string, signal: any): void {
    // Send via WebSocket or BroadcastChannel
    const channel = new BroadcastChannel('mesh-signaling');
    channel.postMessage({ to: peerId, ...signal });
  }

  private deliverMessage(message: Message): void {
    // Emit event or callback to deliver message to app
    window.dispatchEvent(new CustomEvent('mesh-message', { detail: message }));
  }

  private updatePeerList(peers: MeshPeer[]): void {
    peers.forEach((peer) => {
      this.discoveredPeers.set(peer.id, peer);
    });
  }
}

export const meshNetworkService = new MeshNetworkService();
