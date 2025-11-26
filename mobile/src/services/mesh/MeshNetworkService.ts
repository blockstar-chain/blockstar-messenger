// mobile/src/services/mesh/MeshNetworkService.ts
import { Platform, PermissionsAndroid } from 'react-native';
import BleManager from 'react-native-ble-plx';
import { BLEService } from './BLEService';
import { WiFiDirectService } from './WiFiDirectService';
import { storageService } from '../StorageService';

export interface MeshPeer {
  id: string;
  name: string;
  address: string;
  rssi?: number;
  type: 'bluetooth' | 'wifi-direct' | 'websocket';
  connected: boolean;
  lastSeen: number;
}

export interface MeshMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
  encrypted: boolean;
  hops: number;
  maxHops: number;
}

class MeshNetworkService {
  private bleService: BLEService;
  private wifiDirectService: WiFiDirectService;
  private peers: Map<string, MeshPeer> = new Map();
  private messageQueue: MeshMessage[] = [];
  private eventHandlers: Map<string, Function[]> = new Map();
  private isInitialized = false;
  private myPeerId: string = '';

  constructor() {
    this.bleService = new BLEService();
    this.wifiDirectService = new WiFiDirectService();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Request permissions
      await this.requestPermissions();

      // Get or create peer ID
      this.myPeerId = await this.getMyPeerId();

      // Initialize Bluetooth LE
      await this.bleService.initialize(this.myPeerId);

      // Initialize WiFi Direct (Android only)
      if (Platform.OS === 'android') {
        await this.wifiDirectService.initialize(this.myPeerId);
      }

      // Set up event listeners
      this.setupEventListeners();

      // Start peer discovery
      await this.startDiscovery();

      this.isInitialized = true;
      console.log('✅ Mesh network initialized with ID:', this.myPeerId);
    } catch (error) {
      console.error('❌ Mesh network initialization failed:', error);
      throw error;
    }
  }

  private async requestPermissions(): Promise<void> {
    if (Platform.OS === 'android') {
      const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES,
      ];

      const granted = await PermissionsAndroid.requestMultiple(permissions);
      
      const allGranted = Object.values(granted).every(
        status => status === PermissionsAndroid.RESULTS.GRANTED
      );

      if (!allGranted) {
        throw new Error('Mesh networking permissions not granted');
      }
    }
  }

  private async getMyPeerId(): Promise<string> {
    let peerId = storageService.getMeshPeerId();
    
    if (!peerId) {
      // Generate unique peer ID from wallet address + device ID
      const user = storageService.getUser();
      const deviceId = await this.getDeviceId();
      peerId = `${user?.walletAddress?.slice(0, 8)}-${deviceId}`;
      storageService.setMeshPeerId(peerId);
    }

    return peerId;
  }

  private async getDeviceId(): Promise<string> {
    // Generate or retrieve device-specific ID
    let deviceId = storageService.getDeviceId();
    if (!deviceId) {
      deviceId = Math.random().toString(36).substring(2, 10);
      storageService.setDeviceId(deviceId);
    }
    return deviceId;
  }

  private setupEventListeners(): void {
    // BLE peer discovered
    this.bleService.on('peer:discovered', (peer: MeshPeer) => {
      this.handlePeerDiscovered(peer);
    });

    // BLE peer connected
    this.bleService.on('peer:connected', (peer: MeshPeer) => {
      this.handlePeerConnected(peer);
    });

    // BLE peer disconnected
    this.bleService.on('peer:disconnected', (peerId: string) => {
      this.handlePeerDisconnected(peerId);
    });

    // BLE message received
    this.bleService.on('message:received', (message: MeshMessage) => {
      this.handleMessageReceived(message);
    });

    // WiFi Direct peer discovered (Android)
    if (Platform.OS === 'android') {
      this.wifiDirectService.on('peer:discovered', (peer: MeshPeer) => {
        this.handlePeerDiscovered(peer);
      });

      this.wifiDirectService.on('peer:connected', (peer: MeshPeer) => {
        this.handlePeerConnected(peer);
      });

      this.wifiDirectService.on('message:received', (message: MeshMessage) => {
        this.handleMessageReceived(message);
      });
    }
  }

  async startDiscovery(): Promise<void> {
    console.log('🔍 Starting mesh peer discovery...');
    
    // Start BLE scanning and advertising
    await this.bleService.startAdvertising();
    await this.bleService.startScanning();

    // Start WiFi Direct discovery (Android)
    if (Platform.OS === 'android') {
      await this.wifiDirectService.startDiscovery();
    }
  }

  async stopDiscovery(): Promise<void> {
    await this.bleService.stopScanning();
    await this.bleService.stopAdvertising();
    
    if (Platform.OS === 'android') {
      await this.wifiDirectService.stopDiscovery();
    }
  }

  private handlePeerDiscovered(peer: MeshPeer): void {
    console.log('👋 Peer discovered:', peer.id, peer.type);
    
    // Add to peers list if not already there
    if (!this.peers.has(peer.id)) {
      this.peers.set(peer.id, peer);
      this.emit('peer:discovered', peer);
    } else {
      // Update existing peer
      const existing = this.peers.get(peer.id)!;
      this.peers.set(peer.id, { ...existing, ...peer, lastSeen: Date.now() });
    }
  }

  private handlePeerConnected(peer: MeshPeer): void {
    console.log('✅ Peer connected:', peer.id);
    
    const existing = this.peers.get(peer.id);
    if (existing) {
      this.peers.set(peer.id, { ...existing, connected: true });
    } else {
      this.peers.set(peer.id, { ...peer, connected: true });
    }

    this.emit('peer:connected', peer);

    // Send any queued messages to this peer
    this.flushMessageQueue(peer.id);
  }

  private handlePeerDisconnected(peerId: string): void {
    console.log('❌ Peer disconnected:', peerId);
    
    const peer = this.peers.get(peerId);
    if (peer) {
      this.peers.set(peerId, { ...peer, connected: false });
    }

    this.emit('peer:disconnected', peerId);
  }

  private handleMessageReceived(message: MeshMessage): void {
    console.log('📨 Mesh message received:', message.id);

    // Check if message is for us
    if (message.to === this.myPeerId) {
      this.emit('message:received', message);
    } else if (message.hops < message.maxHops) {
      // Forward message (mesh routing)
      this.forwardMessage(message);
    }
  }

  async sendMessage(
    recipientId: string,
    content: string,
    encrypted: boolean = true
  ): Promise<void> {
    const message: MeshMessage = {
      id: `${Date.now()}-${Math.random()}`,
      from: this.myPeerId,
      to: recipientId,
      content,
      timestamp: Date.now(),
      encrypted,
      hops: 0,
      maxHops: 5, // Maximum 5 hops for mesh routing
    };

    // Try to send directly
    const recipient = this.peers.get(recipientId);
    
    if (recipient && recipient.connected) {
      await this.sendDirectMessage(recipient, message);
    } else {
      // Queue for later or use mesh routing
      this.messageQueue.push(message);
      await this.tryMeshRouting(message);
    }
  }

  private async sendDirectMessage(peer: MeshPeer, message: MeshMessage): Promise<void> {
    try {
      if (peer.type === 'bluetooth') {
        await this.bleService.sendMessage(peer.id, message);
      } else if (peer.type === 'wifi-direct' && Platform.OS === 'android') {
        await this.wifiDirectService.sendMessage(peer.id, message);
      }
      
      console.log('✅ Message sent to', peer.id);
    } catch (error) {
      console.error('❌ Failed to send message:', error);
      throw error;
    }
  }

  private async tryMeshRouting(message: MeshMessage): Promise<void> {
    // Find connected peers to use as relays
    const connectedPeers = Array.from(this.peers.values()).filter(p => p.connected);
    
    if (connectedPeers.length === 0) {
      console.warn('⚠️ No connected peers for mesh routing');
      return;
    }

    // Send to all connected peers (they'll forward if needed)
    const forwardedMessage = { ...message, hops: message.hops + 1 };
    
    for (const peer of connectedPeers) {
      try {
        await this.sendDirectMessage(peer, forwardedMessage);
      } catch (error) {
        console.error('Failed to forward message through', peer.id, error);
      }
    }
  }

  private async forwardMessage(message: MeshMessage): Promise<void> {
    console.log('🔀 Forwarding message', message.id, 'hops:', message.hops);
    
    const forwardedMessage = { ...message, hops: message.hops + 1 };
    await this.tryMeshRouting(forwardedMessage);
  }

  private async flushMessageQueue(peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    const messagesForPeer = this.messageQueue.filter(m => m.to === peerId);
    
    for (const message of messagesForPeer) {
      try {
        await this.sendDirectMessage(peer, message);
        // Remove from queue
        const index = this.messageQueue.indexOf(message);
        if (index > -1) {
          this.messageQueue.splice(index, 1);
        }
      } catch (error) {
        console.error('Failed to send queued message:', error);
      }
    }
  }

  getConnectedPeers(): MeshPeer[] {
    return Array.from(this.peers.values()).filter(p => p.connected);
  }

  getAllPeers(): MeshPeer[] {
    return Array.from(this.peers.values());
  }

  async connectToPeer(peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      throw new Error('Peer not found');
    }

    if (peer.type === 'bluetooth') {
      await this.bleService.connectToPeer(peerId);
    } else if (peer.type === 'wifi-direct' && Platform.OS === 'android') {
      await this.wifiDirectService.connectToPeer(peerId);
    }
  }

  async disconnectFromPeer(peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    if (peer.type === 'bluetooth') {
      await this.bleService.disconnectFromPeer(peerId);
    } else if (peer.type === 'wifi-direct' && Platform.OS === 'android') {
      await this.wifiDirectService.disconnectFromPeer(peerId);
    }
  }

  on(event: string, handler: Function): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);

    return () => {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  private emit(event: string, ...args: any[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(...args));
    }
  }

  async shutdown(): Promise<void> {
    await this.stopDiscovery();
    await this.bleService.shutdown();
    
    if (Platform.OS === 'android') {
      await this.wifiDirectService.shutdown();
    }

    this.peers.clear();
    this.messageQueue = [];
    this.isInitialized = false;
  }

  // Mesh network status
  getStatus(): {
    enabled: boolean;
    peersDiscovered: number;
    peersConnected: number;
    messagesQueued: number;
  } {
    return {
      enabled: this.isInitialized,
      peersDiscovered: this.peers.size,
      peersConnected: this.getConnectedPeers().length,
      messagesQueued: this.messageQueue.length,
    };
  }
}

export const meshNetworkService = new MeshNetworkService();
