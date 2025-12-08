// frontend/src/lib/mesh/WifiDirectService.ts
// TypeScript wrapper for the WifiDirect Capacitor plugin

import { registerPlugin } from '@capacitor/core';

// ============================================
// TYPES
// ============================================

export interface WifiDirectPeer {
  deviceName: string;
  deviceAddress: string;
  status: 'available' | 'invited' | 'connected' | 'failed' | 'unavailable' | 'unknown';
  primaryDeviceType?: string;
}

export interface WifiDirectConnectionInfo {
  connected: boolean;
  isGroupOwner?: boolean;
  groupOwnerAddress?: string;
  groupFormed?: boolean;
}

export interface WifiDirectStatus {
  wifiP2pEnabled: boolean;
  discovering: boolean;
  connected: boolean;
  peerCount: number;
  connectedDeviceAddress?: string;
}

export interface WifiDirectPermissions {
  location: 'granted' | 'denied' | 'prompt';
  wifi: 'granted' | 'denied' | 'prompt';
  nearbyDevices: 'granted' | 'denied' | 'prompt';
}

// Plugin interface
interface WifiDirectPluginInterface {
  initialize(): Promise<{ available: boolean; enabled: boolean }>;
  checkPermissions(): Promise<WifiDirectPermissions>;
  requestPermissions(): Promise<WifiDirectPermissions>;
  discoverPeers(): Promise<{ success: boolean }>;
  stopDiscovery(): Promise<void>;
  getPeers(): Promise<{ peers: WifiDirectPeer[] }>;
  connect(options: { deviceAddress: string }): Promise<{ success: boolean }>;
  disconnect(): Promise<void>;
  getConnectionInfo(): Promise<WifiDirectConnectionInfo>;
  sendMessage(options: { message: string }): Promise<{ success: boolean }>;
  getStatus(): Promise<WifiDirectStatus>;
  addListener(
    eventName: 'wifiP2pStateChanged' | 'peersChanged' | 'connectionChanged' | 
               'thisDeviceChanged' | 'groupInfoChanged' | 'socketEvent' | 'messageReceived',
    listenerFunc: (data: any) => void
  ): Promise<{ remove: () => Promise<void> }>;
  removeAllListeners(): Promise<void>;
}

// Register the plugin
const WifiDirectPlugin = registerPlugin<WifiDirectPluginInterface>('WifiDirect');

// ============================================
// WIFI DIRECT SERVICE CLASS
// ============================================

export class WifiDirectService {
  private static instance: WifiDirectService;
  private initialized = false;
  private available = false;
  private enabled = false;
  private discovering = false;
  private peers: WifiDirectPeer[] = [];
  private connectionInfo: WifiDirectConnectionInfo | null = null;
  
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private pluginListeners: Array<{ remove: () => Promise<void> }> = [];

  private constructor() {}

  static getInstance(): WifiDirectService {
    if (!WifiDirectService.instance) {
      WifiDirectService.instance = new WifiDirectService();
    }
    return WifiDirectService.instance;
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return this.available;
    }

    try {
      console.log('📶 Initializing WiFi Direct...');
      
      const result = await WifiDirectPlugin.initialize();
      this.available = result.available;
      this.enabled = result.enabled;
      
      if (this.available) {
        await this.setupListeners();
      }
      
      this.initialized = true;
      console.log(`✅ WiFi Direct initialized - Available: ${this.available}, Enabled: ${this.enabled}`);
      
      return this.available;
    } catch (error) {
      console.error('❌ Failed to initialize WiFi Direct:', error);
      this.available = false;
      this.initialized = true;
      return false;
    }
  }

  private async setupListeners(): Promise<void> {
    // WiFi P2P state changes
    const stateListener = await WifiDirectPlugin.addListener('wifiP2pStateChanged', (data) => {
      this.enabled = data.enabled;
      this.emit('stateChanged', { enabled: data.enabled });
    });
    this.pluginListeners.push(stateListener);

    // Peers changed
    const peersListener = await WifiDirectPlugin.addListener('peersChanged', (data) => {
      this.peers = data.peers || [];
      this.emit('peersChanged', { peers: this.peers });
    });
    this.pluginListeners.push(peersListener);

    // Connection changed
    const connectionListener = await WifiDirectPlugin.addListener('connectionChanged', (data) => {
      this.connectionInfo = data;
      this.emit('connectionChanged', data);
    });
    this.pluginListeners.push(connectionListener);

    // Socket events
    const socketListener = await WifiDirectPlugin.addListener('socketEvent', (data) => {
      this.emit('socketEvent', data);
    });
    this.pluginListeners.push(socketListener);

    // Message received
    const messageListener = await WifiDirectPlugin.addListener('messageReceived', (data) => {
      this.emit('messageReceived', data);
    });
    this.pluginListeners.push(messageListener);
  }

  // ============================================
  // PERMISSIONS
  // ============================================

  async checkPermissions(): Promise<WifiDirectPermissions> {
    try {
      return await WifiDirectPlugin.checkPermissions();
    } catch (error) {
      console.error('Failed to check permissions:', error);
      return { location: 'denied', wifi: 'denied', nearbyDevices: 'denied' };
    }
  }

  async requestPermissions(): Promise<boolean> {
    try {
      const result = await WifiDirectPlugin.requestPermissions();
      return result.location === 'granted';
    } catch (error) {
      console.error('Failed to request permissions:', error);
      return false;
    }
  }

  // ============================================
  // DISCOVERY
  // ============================================

  async startDiscovery(): Promise<boolean> {
    if (!this.available || !this.enabled) {
      console.warn('WiFi Direct not available or enabled');
      return false;
    }

    try {
      await WifiDirectPlugin.discoverPeers();
      this.discovering = true;
      this.emit('discoveryChanged', { discovering: true });
      return true;
    } catch (error) {
      console.error('Failed to start discovery:', error);
      return false;
    }
  }

  async stopDiscovery(): Promise<void> {
    try {
      await WifiDirectPlugin.stopDiscovery();
      this.discovering = false;
      this.emit('discoveryChanged', { discovering: false });
    } catch (error) {
      console.error('Failed to stop discovery:', error);
    }
  }

  async refreshPeers(): Promise<WifiDirectPeer[]> {
    try {
      const result = await WifiDirectPlugin.getPeers();
      this.peers = result.peers || [];
      return this.peers;
    } catch (error) {
      console.error('Failed to get peers:', error);
      return [];
    }
  }

  // ============================================
  // CONNECTION
  // ============================================

  async connect(deviceAddress: string): Promise<boolean> {
    if (!this.available) {
      console.warn('WiFi Direct not available');
      return false;
    }

    try {
      await WifiDirectPlugin.connect({ deviceAddress });
      return true;
    } catch (error) {
      console.error('Failed to connect:', error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await WifiDirectPlugin.disconnect();
      this.connectionInfo = null;
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  }

  async getConnectionInfo(): Promise<WifiDirectConnectionInfo | null> {
    try {
      const info = await WifiDirectPlugin.getConnectionInfo();
      this.connectionInfo = info;
      return info;
    } catch (error) {
      console.error('Failed to get connection info:', error);
      return null;
    }
  }

  // ============================================
  // MESSAGING
  // ============================================

  async sendMessage(message: string): Promise<boolean> {
    try {
      await WifiDirectPlugin.sendMessage({ message });
      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }

  // ============================================
  // STATUS
  // ============================================

  async getStatus(): Promise<WifiDirectStatus> {
    try {
      return await WifiDirectPlugin.getStatus();
    } catch (error) {
      console.error('Failed to get status:', error);
      return {
        wifiP2pEnabled: false,
        discovering: false,
        connected: false,
        peerCount: 0,
      };
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isDiscovering(): boolean {
    return this.discovering;
  }

  isConnected(): boolean {
    return this.connectionInfo?.connected ?? false;
  }

  getPeers(): WifiDirectPeer[] {
    return [...this.peers];
  }

  // ============================================
  // EVENT HANDLING
  // ============================================

  on(event: string, callback: (data: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit(event: string, data: any): void {
    this.listeners.get(event)?.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in WiFi Direct listener for ${event}:`, error);
      }
    });
  }

  // ============================================
  // CLEANUP
  // ============================================

  async destroy(): Promise<void> {
    try {
      await this.stopDiscovery();
      await this.disconnect();
      
      for (const listener of this.pluginListeners) {
        await listener.remove();
      }
      this.pluginListeners = [];
      
      await WifiDirectPlugin.removeAllListeners();
      
      this.listeners.clear();
      this.initialized = false;
      this.available = false;
      this.enabled = false;
      this.peers = [];
      this.connectionInfo = null;
    } catch (error) {
      console.error('Error destroying WiFi Direct service:', error);
    }
  }
}

// Export singleton instance
export const wifiDirectService = WifiDirectService.getInstance();
