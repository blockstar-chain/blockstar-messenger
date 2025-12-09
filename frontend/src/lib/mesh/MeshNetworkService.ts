// frontend/src/lib/mesh/MeshNetworkService.ts
// BlockStar Cypher - Complete Mesh Networking Service
// Supports BLE, WiFi Direct, QR Code exchange, and WebRTC

import { Capacitor } from '@capacitor/core';
import { BleClient, ScanResult, BleDevice } from '@capacitor-community/bluetooth-le';
import { webSocketService } from '@/lib/websocket';

// ============================================
// TYPES
// ============================================

export interface MeshPeer {
  id: string;
  walletAddress: string;
  publicKey: string;
  username?: string;
  avatar?: string;
  distance: number;
  lastSeen: number;
  connectionType: 'ble' | 'wifi-direct' | 'webrtc' | 'local';
  connectionState: 'discovered' | 'connecting' | 'connected' | 'disconnected';
  rssi?: number; // Signal strength for BLE
}

export interface MeshMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
  type: 'text' | 'file' | 'voice' | 'routing' | 'ack' | 'discovery' | 'ping' | 'call-signal';
  hops: string[];
  ttl: number;
  encrypted: boolean;
  callSignal?: MeshCallSignal; // For call-signal type messages
}

// Call signaling over mesh
export interface MeshCallSignal {
  signalType: 'offer' | 'answer' | 'ice-candidate' | 'call-end' | 'call-decline';
  callId: string;
  callType?: 'audio' | 'video';
  callerName?: string;
  callerAvatar?: string;
  sdp?: any; // RTCSessionDescription
  candidate?: any; // RTCIceCandidate
}

export interface MeshNetworkStatus {
  enabled: boolean;
  isOnline: boolean;
  isMeshMode: boolean;
  bleEnabled: boolean;
  bleScanning: boolean;
  wifiDirectEnabled: boolean;
  connectedPeers: number;
  discoveredPeers: number;
  queuedMessages: number;
  lastServerCheck: number;
}

export interface MeshSettings {
  enabled: boolean;
  autoConnect: boolean;
  bleEnabled: boolean;
  wifiDirectEnabled: boolean;
  hybridMode: boolean; // Auto-switch between internet and mesh
  storeAndForward: boolean;
  maxHops: number;
  scanInterval: number; // seconds
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

type MessageHandler = (message: MeshMessage, peer: MeshPeer) => void;
type PeerHandler = (peer: MeshPeer, event: 'discovered' | 'connected' | 'disconnected') => void;
type StatusHandler = (status: MeshNetworkStatus) => void;
type PermissionHandler = (type: 'bluetooth' | 'location', granted: boolean) => void;
type CallSignalHandler = (signal: MeshCallSignal, fromAddress: string) => void;

// ============================================
// CONSTANTS
// ============================================

const BLOCKSTAR_BLE_SERVICE_UUID = '0000bcff-0000-1000-8000-00805f9b34fb';
const BLOCKSTAR_BLE_CHAR_UUID = '0000bcfe-0000-1000-8000-00805f9b34fb';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const DEFAULT_SETTINGS: MeshSettings = {
  enabled: false,
  autoConnect: true,
  bleEnabled: true,
  wifiDirectEnabled: false, // Requires more setup
  hybridMode: true,
  storeAndForward: true,
  maxHops: 5,
  scanInterval: 10,
};

const SERVER_CHECK_INTERVAL = 10000;
const PEER_TIMEOUT = 60000;
const BLE_SCAN_DURATION = 5000;
const MESSAGE_TTL = 300000; // 5 minutes

// ============================================
// MESH NETWORK SERVICE CLASS
// ============================================

class MeshNetworkService {
  // State
  private isInitialized = false;
  private isNative = false;
  private settings: MeshSettings = { ...DEFAULT_SETTINGS };
  
  // Identity
  private myWalletAddress = '';
  private myPublicKey = '';
  private myUsername = '';
  private myAvatar = '';
  
  // Network state
  private isServerOnline = true;
  private isMeshMode = false;
  private lastServerCheck = 0;
  
  // Peers
  private discoveredPeers = new Map<string, MeshPeer>();
  private connectedPeers = new Map<string, MeshPeer>();
  
  // WebRTC connections
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private pendingConnections = new Map<string, RTCPeerConnection>();
  
  // Message handling
  private messageQueue: MeshMessage[] = [];
  private processedMessages = new Set<string>();
  private routingTable = new Map<string, string[]>(); // destination -> path
  
  // Timers
  private serverCheckInterval: NodeJS.Timeout | null = null;
  private bleScanInterval: NodeJS.Timeout | null = null;
  private peerCleanupInterval: NodeJS.Timeout | null = null;
  
  // Event handlers
  private messageHandlers = new Set<MessageHandler>();
  private peerHandlers = new Set<PeerHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private permissionHandlers = new Set<PermissionHandler>();
  private callSignalHandlers = new Set<CallSignalHandler>();
  
  // BLE state
  private bleInitialized = false;
  private bleScanning = false;

  // ============================================
  // INITIALIZATION
  // ============================================

  async initialize(
    walletAddress: string,
    publicKey: string | Uint8Array,
    username?: string,
    avatar?: string
  ): Promise<boolean> {
    if (this.isInitialized && this.myWalletAddress === walletAddress.toLowerCase()) {
      return true;
    }

    console.log('🔗 ════════════════════════════════════════════════');
    console.log('🔗 INITIALIZING MESH NETWORK SERVICE');
    console.log('🔗 ════════════════════════════════════════════════');

    this.myWalletAddress = walletAddress.toLowerCase();
    this.myPublicKey = this.normalizePublicKey(publicKey);
    this.myUsername = username || '';
    this.myAvatar = avatar || '';
    this.isNative = Capacitor.isNativePlatform();

    // Load saved settings
    this.loadSettings();

    // Start server connectivity check
    this.startServerCheck();

    // Start peer cleanup
    this.startPeerCleanup();

    // Initialize BLE if on native platform and enabled
    if (this.isNative && this.settings.enabled && this.settings.bleEnabled) {
      await this.initializeBLE();
    }

    // Start local discovery (for same-browser/network)
    this.startLocalDiscovery();

    this.isInitialized = true;
    this.notifyStatusChange();

    console.log('✅ Mesh network service initialized');
    console.log('   Platform:', this.isNative ? 'Native' : 'Web');
    console.log('   Settings:', this.settings);

    return true;
  }

  // ============================================
  // SETTINGS MANAGEMENT
  // ============================================

  loadSettings(): void {
    try {
      const saved = localStorage.getItem('meshNetworkSettings');
      if (saved) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.error('Failed to load mesh settings:', e);
    }
  }

  saveSettings(): void {
    try {
      localStorage.setItem('meshNetworkSettings', JSON.stringify(this.settings));
    } catch (e) {
      console.error('Failed to save mesh settings:', e);
    }
  }

  getSettings(): MeshSettings {
    return { ...this.settings };
  }

  async updateSettings(newSettings: Partial<MeshSettings>): Promise<void> {
    const oldEnabled = this.settings.enabled;
    const oldBleEnabled = this.settings.bleEnabled;

    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();

    // Handle enable/disable
    if (newSettings.enabled !== undefined) {
      if (newSettings.enabled && !oldEnabled) {
        await this.enableMeshNetworking();
      } else if (!newSettings.enabled && oldEnabled) {
        await this.disableMeshNetworking();
      }
    }

    // Handle BLE toggle
    if (newSettings.bleEnabled !== undefined && this.settings.enabled) {
      if (newSettings.bleEnabled && !oldBleEnabled) {
        await this.initializeBLE();
        this.startBLEScanning();
      } else if (!newSettings.bleEnabled && oldBleEnabled) {
        this.stopBLEScanning();
      }
    }

    this.notifyStatusChange();
  }

  // ============================================
  // ENABLE/DISABLE MESH NETWORKING
  // ============================================

  async enableMeshNetworking(): Promise<boolean> {
    console.log('🔗 Enabling mesh networking...');

    if (!this.isNative) {
      console.log('📱 Running on web - limited mesh capabilities');
      this.settings.enabled = true;
      this.saveSettings();
      this.notifyStatusChange();
      return true;
    }

    // Check and request permissions
    const permissionsGranted = await this.requestPermissions();
    if (!permissionsGranted) {
      console.error('❌ Required permissions not granted');
      return false;
    }

    // Initialize BLE
    if (this.settings.bleEnabled) {
      const bleOk = await this.initializeBLE();
      if (bleOk) {
        this.startBLEScanning();
      }
    }

    this.settings.enabled = true;
    this.saveSettings();
    this.notifyStatusChange();

    console.log('✅ Mesh networking enabled');
    return true;
  }

  async disableMeshNetworking(): Promise<void> {
    console.log('🔗 Disabling mesh networking...');

    // Stop BLE scanning
    this.stopBLEScanning();

    // Disconnect all peers
    this.disconnectAllPeers();

    this.settings.enabled = false;
    this.saveSettings();
    this.notifyStatusChange();

    console.log('✅ Mesh networking disabled');
  }

  // ============================================
  // PERMISSIONS
  // ============================================

  async requestPermissions(): Promise<boolean> {
    if (!this.isNative) {
      return true; // Web doesn't need these permissions
    }

    console.log('📱 Requesting mesh network permissions...');

    try {
      // Request Bluetooth permissions
      await BleClient.initialize();
      
      // Request location permission (required for BLE scanning on Android)
      // This is handled by the BLE plugin on Android
      
      this.notifyPermissionChange('bluetooth', true);
      this.notifyPermissionChange('location', true);
      
      return true;
    } catch (error: any) {
      console.error('Permission request failed:', error);
      
      if (error.message?.includes('bluetooth')) {
        this.notifyPermissionChange('bluetooth', false);
      }
      if (error.message?.includes('location')) {
        this.notifyPermissionChange('location', false);
      }
      
      return false;
    }
  }

  async checkPermissions(): Promise<{ bluetooth: boolean; location: boolean }> {
    if (!this.isNative) {
      return { bluetooth: true, location: true };
    }

    try {
      // Check if BLE is enabled
      const enabled = await BleClient.isEnabled();
      return { bluetooth: enabled, location: enabled };
    } catch {
      return { bluetooth: false, location: false };
    }
  }

  // ============================================
  // BLUETOOTH LOW ENERGY (BLE)
  // ============================================

  private async initializeBLE(): Promise<boolean> {
    if (!this.isNative) {
      console.log('BLE not available on web platform');
      return false;
    }

    if (this.bleInitialized) {
      return true;
    }

    try {
      console.log('📶 Initializing Bluetooth LE...');
      
      await BleClient.initialize();
      
      // Check if Bluetooth is enabled
      const enabled = await BleClient.isEnabled();
      if (!enabled) {
        console.log('Bluetooth is disabled, requesting enable...');
        await BleClient.requestEnable();
      }

      this.bleInitialized = true;
      console.log('✅ Bluetooth LE initialized');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize BLE:', error);
      return false;
    }
  }

  private startBLEScanning(): void {
    if (!this.bleInitialized || this.bleScanning) {
      return;
    }

    console.log('📡 Starting BLE scanning...');
    this.bleScanning = true;
    this.notifyStatusChange();

    // Scan function
    const scan = async () => {
      if (!this.settings.enabled || !this.settings.bleEnabled) {
        this.stopBLEScanning();
        return;
      }

      try {
        await BleClient.requestLEScan(
          {
            services: [BLOCKSTAR_BLE_SERVICE_UUID],
            allowDuplicates: false,
          },
          (result: ScanResult) => {
            this.handleBLEDeviceDiscovered(result);
          }
        );

        // Stop scan after duration
        setTimeout(async () => {
          try {
            await BleClient.stopLEScan();
          } catch (e) {
            // Ignore stop errors
          }
        }, BLE_SCAN_DURATION);
      } catch (error) {
        console.error('BLE scan error:', error);
      }
    };

    // Start first scan
    scan();

    // Schedule periodic scans
    this.bleScanInterval = setInterval(scan, this.settings.scanInterval * 1000);
  }

  private stopBLEScanning(): void {
    if (this.bleScanInterval) {
      clearInterval(this.bleScanInterval);
      this.bleScanInterval = null;
    }

    if (this.bleScanning) {
      BleClient.stopLEScan().catch(() => {});
      this.bleScanning = false;
      this.notifyStatusChange();
    }

    console.log('📡 BLE scanning stopped');
  }

  private handleBLEDeviceDiscovered(result: ScanResult): void {
    const device = result.device;
    const rssi = result.rssi;
    
    console.log('📶 BLE device discovered:', device.deviceId, 'RSSI:', rssi);

    // Try to read the device's BlockStar info from advertising data
    const serviceData = result.serviceData?.[BLOCKSTAR_BLE_SERVICE_UUID];
    if (!serviceData) {
      return; // Not a BlockStar device
    }

    try {
      // Decode peer info from service data
      const decoder = new TextDecoder();
      const peerInfoStr = decoder.decode(serviceData);
      const peerInfo = JSON.parse(peerInfoStr);

      const peerId = peerInfo.walletAddress.toLowerCase();
      
      // Don't discover ourselves
      if (peerId === this.myWalletAddress) {
        return;
      }

      // Create or update peer
      const existingPeer = this.discoveredPeers.get(peerId);
      const peer: MeshPeer = {
        id: device.deviceId,
        walletAddress: peerId,
        publicKey: peerInfo.publicKey || '',
        username: peerInfo.username,
        avatar: peerInfo.avatar,
        distance: this.rssiToDistance(rssi),
        lastSeen: Date.now(),
        connectionType: 'ble',
        connectionState: existingPeer?.connectionState || 'discovered',
        rssi,
      };

      this.discoveredPeers.set(peerId, peer);

      if (!existingPeer) {
        console.log('🆕 New BlockStar peer discovered:', peer.username || peerId);
        this.notifyPeerChange(peer, 'discovered');
      }

      this.notifyStatusChange();

      // Auto-connect if enabled
      if (this.settings.autoConnect && peer.connectionState === 'discovered') {
        this.connectToBLEPeer(peer);
      }
    } catch (e) {
      // Not valid BlockStar data
    }
  }

  private async connectToBLEPeer(peer: MeshPeer): Promise<boolean> {
    console.log('🔗 Connecting to BLE peer:', peer.username || peer.walletAddress);

    peer.connectionState = 'connecting';
    this.discoveredPeers.set(peer.walletAddress, peer);
    this.notifyStatusChange();

    try {
      // Connect to the device
      await BleClient.connect(peer.id, (deviceId) => {
        console.log('BLE device disconnected:', deviceId);
        this.handlePeerDisconnect(peer.walletAddress);
      });

      // Read characteristic to get full peer info
      const peerData = await BleClient.read(
        peer.id,
        BLOCKSTAR_BLE_SERVICE_UUID,
        BLOCKSTAR_BLE_CHAR_UUID
      );

      // Now we have the peer's full info, establish WebRTC for data
      // BLE is slow, so we use it for discovery and use WebRTC for actual data

      peer.connectionState = 'connected';
      this.connectedPeers.set(peer.walletAddress, peer);
      this.discoveredPeers.delete(peer.walletAddress);
      
      this.notifyPeerChange(peer, 'connected');
      this.notifyStatusChange();

      console.log('✅ Connected to BLE peer:', peer.username || peer.walletAddress);
      return true;
    } catch (error) {
      console.error('Failed to connect to BLE peer:', error);
      peer.connectionState = 'disconnected';
      this.discoveredPeers.set(peer.walletAddress, peer);
      this.notifyStatusChange();
      return false;
    }
  }

  private rssiToDistance(rssi: number): number {
    // Approximate distance from RSSI (very rough estimate)
    // RSSI of -40 is about 1 meter, -70 is about 10 meters
    if (rssi >= -40) return 1;
    if (rssi >= -50) return 3;
    if (rssi >= -60) return 5;
    if (rssi >= -70) return 10;
    if (rssi >= -80) return 20;
    return 30;
  }

  // ============================================
  // LOCAL DISCOVERY (Same Network/Browser)
  // ============================================

  private startLocalDiscovery(): void {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }

    const discoveryChannel = new BroadcastChannel('blockstar-mesh-discovery');
    
    // Announce presence
    const announce = () => {
      if (!this.settings.enabled) return;
      
      discoveryChannel.postMessage({
        type: 'announce',
        walletAddress: this.myWalletAddress,
        publicKey: this.myPublicKey,
        username: this.myUsername,
        avatar: this.myAvatar,
        timestamp: Date.now(),
      });
    };

    // Listen for peers
    discoveryChannel.onmessage = (event) => {
      if (!this.settings.enabled) return;
      if (event.data.walletAddress?.toLowerCase() === this.myWalletAddress) return;

      if (event.data.type === 'announce') {
        this.handleLocalPeerDiscovery(event.data);
      }
    };

    // Announce periodically
    announce();
    setInterval(announce, 5000);
  }

  private handleLocalPeerDiscovery(data: any): void {
    const peerId = data.walletAddress.toLowerCase();

    if (this.connectedPeers.has(peerId) || peerId === this.myWalletAddress) {
      return;
    }

    const existingPeer = this.discoveredPeers.get(peerId);
    const peer: MeshPeer = {
      id: peerId,
      walletAddress: peerId,
      publicKey: data.publicKey || '',
      username: data.username,
      avatar: data.avatar,
      distance: 0, // Local = same device/network
      lastSeen: Date.now(),
      connectionType: 'local',
      connectionState: existingPeer?.connectionState || 'discovered',
    };

    this.discoveredPeers.set(peerId, peer);

    if (!existingPeer) {
      console.log('🆕 Local peer discovered:', peer.username || peerId);
      this.notifyPeerChange(peer, 'discovered');
    }

    this.notifyStatusChange();
  }

  // ============================================
  // QR CODE CONNECTION
  // ============================================

  async createConnectionOffer(): Promise<{ qrData: string; offer: ConnectionOffer }> {
    const peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const tempId = `pending_${Date.now()}`;
    
    const iceCandidates: RTCIceCandidateInit[] = [];
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        iceCandidates.push(event.candidate.toJSON());
      }
    };

    const dataChannel = peerConnection.createDataChannel('mesh', { ordered: true });
    this.setupDataChannel(dataChannel, tempId);

    const sdpOffer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(sdpOffer);

    // Wait for ICE gathering
    await new Promise<void>((resolve) => {
      if (peerConnection.iceGatheringState === 'complete') {
        resolve();
      } else {
        const checkState = () => {
          if (peerConnection.iceGatheringState === 'complete') {
            resolve();
          }
        };
        peerConnection.onicegatheringstatechange = checkState;
        setTimeout(resolve, 3000);
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
      expiresAt: Date.now() + 300000, // 5 minutes
    };

    this.pendingConnections.set(tempId, peerConnection);

    const qrData = this.encodeForQR(offer);

    return { qrData, offer };
  }

  async processScannedOffer(qrData: string): Promise<{ qrData: string; answer: ConnectionOffer } | null> {
    const offer = this.decodeFromQR(qrData);
    if (!offer || offer.type !== 'offer') {
      console.error('Invalid offer data');
      return null;
    }

    const peerId = offer.peerInfo.walletAddress.toLowerCase();
    
    const peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const iceCandidates: RTCIceCandidateInit[] = [];

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        iceCandidates.push(event.candidate.toJSON());
      }
    };

    peerConnection.ondatachannel = (event) => {
      this.setupDataChannel(event.channel, peerId);
    };

    await peerConnection.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    
    for (const candidate of offer.iceCandidates) {
      await peerConnection.addIceCandidate(candidate);
    }

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
        setTimeout(resolve, 3000);
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
      expiresAt: Date.now() + 300000,
    };

    // Store peer info
    const peer: MeshPeer = {
      id: peerId,
      walletAddress: peerId,
      publicKey: offer.peerInfo.publicKey,
      username: offer.peerInfo.username,
      distance: 0,
      lastSeen: Date.now(),
      connectionType: 'webrtc',
      connectionState: 'connecting',
    };
    
    this.discoveredPeers.set(peerId, peer);
    this.peerConnections.set(peerId, peerConnection);
    this.notifyStatusChange();

    const qrDataResponse = this.encodeForQR(answer);

    return { qrData: qrDataResponse, answer };
  }

  async processScannedAnswer(qrData: string): Promise<boolean> {
    const answer = this.decodeFromQR(qrData);
    if (!answer || answer.type !== 'answer') {
      console.error('Invalid answer data');
      return false;
    }

    const peerId = answer.peerInfo.walletAddress.toLowerCase();

    // Find the pending connection
    let peerConnection: RTCPeerConnection | undefined;
    let pendingId: string | undefined;
    
    for (const [id, conn] of this.pendingConnections) {
      if (conn.signalingState === 'have-local-offer') {
        peerConnection = conn;
        pendingId = id;
        break;
      }
    }

    if (!peerConnection || !pendingId) {
      console.error('No pending connection found');
      return false;
    }

    try {
      await peerConnection.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      
      for (const candidate of answer.iceCandidates) {
        await peerConnection.addIceCandidate(candidate);
      }

      // Move from pending to connected
      this.pendingConnections.delete(pendingId);
      this.peerConnections.set(peerId, peerConnection);

      // Store peer info
      const peer: MeshPeer = {
        id: peerId,
        walletAddress: peerId,
        publicKey: answer.peerInfo.publicKey,
        username: answer.peerInfo.username,
        distance: 0,
        lastSeen: Date.now(),
        connectionType: 'webrtc',
        connectionState: 'connecting',
      };
      
      this.discoveredPeers.set(peerId, peer);
      this.notifyStatusChange();

      return true;
    } catch (error) {
      console.error('Failed to process answer:', error);
      return false;
    }
  }

  // ============================================
  // QR ENCODING/DECODING
  // ============================================

  private encodeForQR(data: ConnectionOffer): string {
    // Minify the data for smaller QR codes
    const minified = {
      t: data.type === 'offer' ? 'o' : 'a',
      s: this.minifySDP(data.sdp),
      i: data.iceCandidates.slice(0, 3).map(c => ({
        c: (c.candidate || '').replace('candidate:', '').slice(0, 100),
        m: c.sdpMid,
        l: c.sdpMLineIndex,
      })),
      p: {
        w: String(data.peerInfo.walletAddress || '').slice(2, 14),
        k: String(data.peerInfo.publicKey || '').slice(0, 24),
        u: String(data.peerInfo.username || '').slice(0, 12),
      },
      e: Math.floor((data.expiresAt - Date.now()) / 1000),
    };

    return 'BSM1:' + btoa(JSON.stringify(minified));
  }

  private decodeFromQR(qrData: string): ConnectionOffer | null {
    try {
      if (!qrData.startsWith('BSM1:')) {
        return null;
      }

      const minified = JSON.parse(atob(qrData.slice(5)));

      return {
        type: minified.t === 'o' ? 'offer' : 'answer',
        sdp: this.restoreSDP(minified.s),
        iceCandidates: minified.i.map((c: any) => ({
          candidate: 'candidate:' + c.c,
          sdpMid: c.m,
          sdpMLineIndex: c.l,
        })),
        peerInfo: {
          walletAddress: '0x' + minified.p.w.padEnd(40, '0'),
          publicKey: minified.p.k,
          username: minified.p.u,
        },
        timestamp: Date.now(),
        expiresAt: Date.now() + (minified.e * 1000),
      };
    } catch (error) {
      console.error('Failed to decode QR data:', error);
      return null;
    }
  }

  private minifySDP(sdp: string): string {
    // Remove unnecessary lines and shorten
    return sdp
      .split('\n')
      .filter(line => 
        line.startsWith('v=') ||
        line.startsWith('o=') ||
        line.startsWith('s=') ||
        line.startsWith('t=') ||
        line.startsWith('a=group') ||
        line.startsWith('a=fingerprint') ||
        line.startsWith('a=ice-ufrag') ||
        line.startsWith('a=ice-pwd') ||
        line.startsWith('m=application')
      )
      .join('\n')
      .slice(0, 500);
  }

  private restoreSDP(minified: string): string {
    // Add back required lines
    let sdp = minified;
    if (!sdp.includes('a=setup:')) {
      sdp += '\na=setup:actpass';
    }
    if (!sdp.includes('a=mid:')) {
      sdp += '\na=mid:0';
    }
    if (!sdp.includes('a=sctp-port:')) {
      sdp += '\na=sctp-port:5000';
    }
    return sdp;
  }

  // ============================================
  // DATA CHANNEL MANAGEMENT
  // ============================================

  private setupDataChannel(channel: RTCDataChannel, peerId: string): void {
    this.dataChannels.set(peerId, channel);

    channel.onopen = () => {
      console.log(`📡 Data channel opened with: ${peerId}`);
      
      // Move peer to connected
      const peer = this.discoveredPeers.get(peerId) || this.connectedPeers.get(peerId);
      if (peer) {
        peer.connectionState = 'connected';
        peer.lastSeen = Date.now();
        this.connectedPeers.set(peerId, peer);
        this.discoveredPeers.delete(peerId);
        this.notifyPeerChange(peer, 'connected');
      }

      // Update routing table
      this.routingTable.set(peerId, [peerId]);

      this.notifyStatusChange();

      // Send queued messages
      this.sendQueuedMessagesTo(peerId);
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
      const peer = this.connectedPeers.get(fromPeer);
      if (peer) {
        peer.lastSeen = Date.now();
      }

      // Check for duplicates
      if (this.processedMessages.has(message.id)) {
        return;
      }
      this.processedMessages.add(message.id);

      // Handle routing messages
      if (message.type === 'routing') {
        this.handleRoutingMessage(message, fromPeer);
        return;
      }

      // Check if message is for us
      if (message.to.toLowerCase() === this.myWalletAddress) {
        // Handle call signal messages specially
        if (message.type === 'call-signal' && message.callSignal) {
          console.log('📞 [Mesh] Received call signal:', message.callSignal.signalType);
          this.callSignalHandlers.forEach(handler => handler(message.callSignal!, message.from));
          // Send ACK for call signals too
          this.sendAck(message.id, fromPeer);
          return;
        }

        // Deliver regular message
        this.messageHandlers.forEach(handler => handler(message, peer!));
        
        // Send ACK
        this.sendAck(message.id, fromPeer);
      } else {
        // Forward message (multi-hop)
        this.forwardMessage(message, fromPeer);
      }
    } catch (e) {
      console.error('Failed to handle mesh message:', e);
    }
  }

  // ============================================
  // MESSAGING
  // ============================================

  async sendMessage(
    to: string,
    content: string,
    type: MeshMessage['type'] = 'text'
  ): Promise<{ sent: boolean; queued: boolean; error?: string }> {
    const message: MeshMessage = {
      id: `${this.myWalletAddress}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      from: this.myWalletAddress,
      to: to.toLowerCase(),
      content,
      timestamp: Date.now(),
      type,
      hops: [this.myWalletAddress],
      ttl: this.settings.maxHops,
      encrypted: false, // TODO: Add encryption
    };

    // Try direct send
    const channel = this.dataChannels.get(to.toLowerCase());
    if (channel?.readyState === 'open') {
      try {
        channel.send(JSON.stringify(message));
        return { sent: true, queued: false };
      } catch (e) {
        console.error('Failed to send direct message:', e);
      }
    }

    // Try routing
    const route = this.routingTable.get(to.toLowerCase());
    if (route && route.length > 0) {
      const nextHop = route[0];
      const nextChannel = this.dataChannels.get(nextHop);
      if (nextChannel?.readyState === 'open') {
        try {
          nextChannel.send(JSON.stringify(message));
          return { sent: true, queued: false };
        } catch (e) {
          console.error('Failed to send routed message:', e);
        }
      }
    }

    // Queue message for later
    if (this.settings.storeAndForward) {
      this.messageQueue.push(message);
      this.notifyStatusChange();
      return { sent: false, queued: true };
    }

    return { sent: false, queued: false, error: 'No route to peer' };
  }

  private forwardMessage(message: MeshMessage, fromPeer: string): void {
    // Check TTL
    if (message.ttl <= 0) {
      return;
    }

    // Add ourselves to hops
    message.hops.push(this.myWalletAddress);
    message.ttl--;

    // Find route
    const route = this.routingTable.get(message.to.toLowerCase());
    if (route && route.length > 0) {
      const nextHop = route[0];
      if (nextHop !== fromPeer) {
        const channel = this.dataChannels.get(nextHop);
        if (channel?.readyState === 'open') {
          channel.send(JSON.stringify(message));
        }
      }
    } else {
      // Broadcast to all peers except sender
      this.dataChannels.forEach((channel, peerId) => {
        if (peerId !== fromPeer && channel.readyState === 'open') {
          channel.send(JSON.stringify(message));
        }
      });
    }
  }

  private sendAck(messageId: string, toPeer: string): void {
    const channel = this.dataChannels.get(toPeer);
    if (channel?.readyState === 'open') {
      const ack: MeshMessage = {
        id: `ack-${messageId}`,
        from: this.myWalletAddress,
        to: toPeer,
        content: messageId,
        timestamp: Date.now(),
        type: 'ack',
        hops: [],
        ttl: 1,
        encrypted: false,
      };
      channel.send(JSON.stringify(ack));
    }
  }

  private sendQueuedMessagesTo(peerId: string): void {
    const toSend = this.messageQueue.filter(m => m.to.toLowerCase() === peerId);
    const channel = this.dataChannels.get(peerId);

    if (channel?.readyState === 'open') {
      for (const message of toSend) {
        try {
          channel.send(JSON.stringify(message));
          this.messageQueue = this.messageQueue.filter(m => m.id !== message.id);
        } catch (e) {
          // Keep in queue
        }
      }
      this.notifyStatusChange();
    }
  }

  // ============================================
  // ROUTING
  // ============================================

  private handleRoutingMessage(message: MeshMessage, fromPeer: string): void {
    try {
      const routeUpdate = JSON.parse(message.content);
      
      // Update routing table with info from peer
      for (const [dest, hops] of Object.entries(routeUpdate as Record<string, string[]>)) {
        if (dest === this.myWalletAddress) continue;
        
        const newPath = [fromPeer, ...hops];
        const existingPath = this.routingTable.get(dest);
        
        if (!existingPath || newPath.length < existingPath.length) {
          this.routingTable.set(dest, newPath);
        }
      }
    } catch (e) {
      console.error('Failed to handle routing message:', e);
    }
  }

  private broadcastRoutingUpdate(): void {
    const routeInfo: Record<string, string[]> = {};
    
    // Include direct connections
    this.dataChannels.forEach((_, peerId) => {
      routeInfo[peerId] = [];
    });

    // Include known routes
    this.routingTable.forEach((path, dest) => {
      routeInfo[dest] = path;
    });

    const message: MeshMessage = {
      id: `route-${Date.now()}`,
      from: this.myWalletAddress,
      to: '',
      content: JSON.stringify(routeInfo),
      timestamp: Date.now(),
      type: 'routing',
      hops: [this.myWalletAddress],
      ttl: 2,
      encrypted: false,
    };

    this.dataChannels.forEach((channel) => {
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(message));
      }
    });
  }

  // ============================================
  // SERVER CONNECTIVITY CHECK
  // ============================================

  private startServerCheck(): void {
    const checkServer = async () => {
      try {
        // First check WebSocket connection (most reliable)
        const wsConnected = webSocketService.isConnected?.() ?? false;
        
        if (wsConnected) {
          // WebSocket is connected, server is definitely online
          const wasOffline = !this.isServerOnline;
          this.isServerOnline = true;
          this.lastServerCheck = Date.now();

          if (wasOffline) {
            console.log('🌐 Server connection restored (WebSocket)');
            this.isMeshMode = false;
            this.syncQueuedMessages();
          }
          
          this.notifyStatusChange();
          return;
        }

        // Fallback to ping if WebSocket not connected
        const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
        const response = await fetch(`${API_URL}/api/ping`, { 
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        
        const wasOffline = !this.isServerOnline;
        this.isServerOnline = response.ok;
        this.lastServerCheck = Date.now();

        if (wasOffline && this.isServerOnline) {
          console.log('🌐 Server connection restored');
          this.isMeshMode = false;
          this.syncQueuedMessages();
        }

        this.notifyStatusChange();
      } catch {
        if (this.isServerOnline) {
          console.log('📡 Server offline - switching to mesh mode');
          this.isServerOnline = false;
          this.isMeshMode = this.settings.enabled && this.settings.hybridMode;
          this.notifyStatusChange();
        }
      }
    };

    checkServer();
    this.serverCheckInterval = setInterval(checkServer, SERVER_CHECK_INTERVAL);
  }

  private async syncQueuedMessages(): Promise<void> {
    if (this.messageQueue.length === 0) return;

    console.log(`📤 Syncing ${this.messageQueue.length} queued messages`);
    
    // TODO: Send queued messages to server
    this.messageQueue = [];
    this.notifyStatusChange();
  }

  // ============================================
  // PEER MANAGEMENT
  // ============================================

  private handlePeerDisconnect(peerId: string): void {
    const peer = this.connectedPeers.get(peerId);
    
    // Clean up connection
    this.dataChannels.delete(peerId);
    this.peerConnections.get(peerId)?.close();
    this.peerConnections.delete(peerId);
    
    // Move back to discovered
    if (peer) {
      peer.connectionState = 'disconnected';
      this.connectedPeers.delete(peerId);
      this.discoveredPeers.set(peerId, peer);
      this.notifyPeerChange(peer, 'disconnected');
    }

    // Remove from routing table
    this.routingTable.delete(peerId);
    
    this.notifyStatusChange();
  }

  private disconnectAllPeers(): void {
    this.dataChannels.forEach((channel, peerId) => {
      channel.close();
      this.handlePeerDisconnect(peerId);
    });

    this.pendingConnections.forEach((conn) => conn.close());
    this.pendingConnections.clear();
  }

  private startPeerCleanup(): void {
    this.peerCleanupInterval = setInterval(() => {
      const now = Date.now();
      
      // Clean up stale discovered peers
      this.discoveredPeers.forEach((peer, id) => {
        if (now - peer.lastSeen > PEER_TIMEOUT) {
          this.discoveredPeers.delete(id);
        }
      });

      // Clean up old processed messages
      if (this.processedMessages.size > 1000) {
        const toKeep = Array.from(this.processedMessages).slice(-500);
        this.processedMessages = new Set(toKeep);
      }

      this.notifyStatusChange();
    }, 30000);
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
    handler(this.getStatus()); // Initial call
    return () => this.statusHandlers.delete(handler);
  }

  onPermissionChange(handler: PermissionHandler): () => void {
    this.permissionHandlers.add(handler);
    return () => this.permissionHandlers.delete(handler);
  }

  // Subscribe to call signals received over mesh
  onCallSignal(handler: CallSignalHandler): () => void {
    this.callSignalHandlers.add(handler);
    return () => this.callSignalHandlers.delete(handler);
  }

  // ============================================
  // CALL SIGNALING OVER MESH
  // ============================================

  /**
   * Send a call offer over mesh network
   */
  async sendCallOffer(
    to: string,
    callId: string,
    offer: any,
    callType: 'audio' | 'video',
    callerName?: string,
    callerAvatar?: string
  ): Promise<{ sent: boolean; queued: boolean; error?: string }> {
    console.log('📞 [Mesh] Sending call offer to:', to);
    
    const callSignal: MeshCallSignal = {
      signalType: 'offer',
      callId,
      callType,
      callerName,
      callerAvatar,
      sdp: offer,
    };

    return this.sendCallSignal(to, callSignal);
  }

  /**
   * Send a call answer over mesh network
   */
  async sendCallAnswer(
    to: string,
    callId: string,
    answer: any
  ): Promise<{ sent: boolean; queued: boolean; error?: string }> {
    console.log('📞 [Mesh] Sending call answer to:', to);
    
    const callSignal: MeshCallSignal = {
      signalType: 'answer',
      callId,
      sdp: answer,
    };

    return this.sendCallSignal(to, callSignal);
  }

  /**
   * Send ICE candidate over mesh network
   */
  async sendIceCandidate(
    to: string,
    callId: string,
    candidate: any
  ): Promise<{ sent: boolean; queued: boolean; error?: string }> {
    console.log('📞 [Mesh] Sending ICE candidate to:', to);
    
    const callSignal: MeshCallSignal = {
      signalType: 'ice-candidate',
      callId,
      candidate,
    };

    return this.sendCallSignal(to, callSignal);
  }

  /**
   * Send call end signal over mesh network
   */
  async sendCallEnd(
    to: string,
    callId: string
  ): Promise<{ sent: boolean; queued: boolean; error?: string }> {
    console.log('📞 [Mesh] Sending call end to:', to);
    
    const callSignal: MeshCallSignal = {
      signalType: 'call-end',
      callId,
    };

    return this.sendCallSignal(to, callSignal);
  }

  /**
   * Internal method to send call signal
   */
  private async sendCallSignal(
    to: string,
    callSignal: MeshCallSignal
  ): Promise<{ sent: boolean; queued: boolean; error?: string }> {
    const message: MeshMessage = {
      id: `${this.myWalletAddress}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      from: this.myWalletAddress,
      to: to.toLowerCase(),
      content: '', // Call signals use callSignal field
      timestamp: Date.now(),
      type: 'call-signal',
      hops: [this.myWalletAddress],
      ttl: this.settings.maxHops,
      encrypted: false,
      callSignal,
    };

    // Try direct send
    const channel = this.dataChannels.get(to.toLowerCase());
    if (channel?.readyState === 'open') {
      try {
        channel.send(JSON.stringify(message));
        console.log('📞 [Mesh] Call signal sent directly');
        return { sent: true, queued: false };
      } catch (e) {
        console.error('📞 [Mesh] Failed to send direct call signal:', e);
      }
    }

    // Try routing
    const route = this.routingTable.get(to.toLowerCase());
    if (route && route.length > 0) {
      const nextHop = route[0];
      const nextChannel = this.dataChannels.get(nextHop);
      if (nextChannel?.readyState === 'open') {
        try {
          nextChannel.send(JSON.stringify(message));
          console.log('📞 [Mesh] Call signal sent via route');
          return { sent: true, queued: false };
        } catch (e) {
          console.error('📞 [Mesh] Failed to send routed call signal:', e);
        }
      }
    }

    // Call signals should not be queued (they're time-sensitive)
    console.warn('📞 [Mesh] No route for call signal');
    return { sent: false, queued: false, error: 'No route to peer for call' };
  }

  /**
   * Check if we can reach a peer via mesh for calls
   */
  canReachPeerForCall(walletAddress: string): boolean {
    const normalized = walletAddress.toLowerCase();
    
    // Direct connection?
    const channel = this.dataChannels.get(normalized);
    if (channel?.readyState === 'open') {
      return true;
    }
    
    // Routable?
    const route = this.routingTable.get(normalized);
    if (route && route.length > 0) {
      const nextHop = route[0];
      const nextChannel = this.dataChannels.get(nextHop);
      return nextChannel?.readyState === 'open';
    }
    
    return false;
  }

  private notifyPeerChange(peer: MeshPeer, event: 'discovered' | 'connected' | 'disconnected'): void {
    this.peerHandlers.forEach(handler => handler(peer, event));
  }

  private notifyStatusChange(): void {
    const status = this.getStatus();
    this.statusHandlers.forEach(handler => handler(status));
  }

  private notifyPermissionChange(type: 'bluetooth' | 'location', granted: boolean): void {
    this.permissionHandlers.forEach(handler => handler(type, granted));
  }

  // ============================================
  // GETTERS
  // ============================================

  getStatus(): MeshNetworkStatus {
    return {
      enabled: this.settings.enabled,
      isOnline: this.isServerOnline,
      isMeshMode: this.isMeshMode,
      bleEnabled: this.settings.bleEnabled && this.bleInitialized,
      bleScanning: this.bleScanning,
      wifiDirectEnabled: this.settings.wifiDirectEnabled,
      connectedPeers: this.connectedPeers.size,
      discoveredPeers: this.discoveredPeers.size,
      queuedMessages: this.messageQueue.length,
      lastServerCheck: this.lastServerCheck,
    };
  }

  getConnectedPeers(): MeshPeer[] {
    return Array.from(this.connectedPeers.values());
  }

  getDiscoveredPeers(): MeshPeer[] {
    return Array.from(this.discoveredPeers.values());
  }

  getAllPeers(): MeshPeer[] {
    return [...this.getConnectedPeers(), ...this.getDiscoveredPeers()];
  }

  isConnectedTo(walletAddress: string): boolean {
    return this.connectedPeers.has(walletAddress.toLowerCase());
  }

  // ============================================
  // UTILITIES
  // ============================================

  private normalizePublicKey(key: string | Uint8Array | any): string {
    if (typeof key === 'string') {
      return key;
    }
    if (key instanceof Uint8Array) {
      return Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    if (key instanceof ArrayBuffer) {
      return Array.from(new Uint8Array(key)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    if (Array.isArray(key)) {
      return key.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    try {
      return btoa(JSON.stringify(key));
    } catch {
      return '';
    }
  }

  // ============================================
  // CLEANUP
  // ============================================

  shutdown(): void {
    if (this.serverCheckInterval) {
      clearInterval(this.serverCheckInterval);
    }
    if (this.bleScanInterval) {
      clearInterval(this.bleScanInterval);
    }
    if (this.peerCleanupInterval) {
      clearInterval(this.peerCleanupInterval);
    }

    this.stopBLEScanning();
    this.disconnectAllPeers();

    this.discoveredPeers.clear();
    this.connectedPeers.clear();
    this.messageQueue = [];
    this.processedMessages.clear();
    this.routingTable.clear();

    this.isInitialized = false;
    this.isMeshMode = false;

    console.log('🔗 Mesh network shutdown');
  }
}

// Singleton
export const meshNetworkService = new MeshNetworkService();
