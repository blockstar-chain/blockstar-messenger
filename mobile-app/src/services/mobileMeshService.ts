import BleManager from 'react-native-ble-manager';
import WiFiP2PManager from 'react-native-wifi-p2p';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { Message } from '../types';

const BleManagerModule = NativeModules.BleManager;
const bleEmitter = new NativeEventEmitter(BleManagerModule);

/**
 * Mobile Mesh Networking Service
 * TRUE mesh networking using Bluetooth Low Energy and WiFi Direct
 * Works offline without internet connection
 */

export class MobileMeshService {
  private bleEnabled: boolean = false;
  private wifiP2PEnabled: boolean = false;
  private discoveredPeers: Map<string, any> = new Map();
  private connectedPeers: Set<string> = new Set();
  private messageQueue: Message[] = [];

  /**
   * Initialize mesh networking
   */
  async initialize(): Promise<void> {
    try {
      // Initialize BLE
      await this.initializeBLE();

      // Initialize WiFi Direct (Android only)
      if (Platform.OS === 'android') {
        await this.initializeWiFiDirect();
      }

      console.log('Mobile mesh networking initialized');
    } catch (error) {
      console.error('Failed to initialize mesh networking:', error);
    }
  }

  /**
   * Initialize Bluetooth Low Energy
   */
  private async initializeBLE(): Promise<void> {
    try {
      await BleManager.start({ showAlert: false });

      // Set up event listeners
      bleEmitter.addListener('BleManagerDiscoverPeripheral', (peripheral) => {
        this.handleBLEPeripheralDiscovered(peripheral);
      });

      bleEmitter.addListener('BleManagerConnectPeripheral', (peripheral) => {
        console.log('BLE Connected:', peripheral.id);
        this.connectedPeers.add(peripheral.id);
      });

      bleEmitter.addListener('BleManagerDisconnectPeripheral', (peripheral) => {
        console.log('BLE Disconnected:', peripheral.id);
        this.connectedPeers.delete(peripheral.id);
      });

      this.bleEnabled = true;
      console.log('BLE initialized');
    } catch (error) {
      console.error('BLE initialization failed:', error);
    }
  }

  /**
   * Initialize WiFi Direct (Android only)
   */
  private async initializeWiFiDirect(): Promise<void> {
    try {
      const isAvailable = await WiFiP2PManager.isWiFiP2PAvailable();

      if (isAvailable) {
        // Subscribe to events
        WiFiP2PManager.subscribeOnPeersUpdates((peers) => {
          this.handleWiFiP2PPeersUpdated(peers);
        });

        WiFiP2PManager.subscribeOnConnectionInfoUpdates((info) => {
          this.handleWiFiP2PConnectionInfo(info);
        });

        this.wifiP2PEnabled = true;
        console.log('WiFi Direct initialized');
      }
    } catch (error) {
      console.error('WiFi Direct initialization failed:', error);
    }
  }

  /**
   * Start discovering nearby peers
   */
  async startDiscovery(): Promise<void> {
    // BLE Discovery
    if (this.bleEnabled) {
      try {
        await BleManager.scan([], 30, false); // Scan for 30 seconds
        console.log('BLE scan started');
      } catch (error) {
        console.error('BLE scan failed:', error);
      }
    }

    // WiFi Direct Discovery (Android)
    if (this.wifiP2PEnabled && Platform.OS === 'android') {
      try {
        await WiFiP2PManager.discoverPeers();
        console.log('WiFi Direct discovery started');
      } catch (error) {
        console.error('WiFi Direct discovery failed:', error);
      }
    }
  }

  /**
   * Stop discovery
   */
  async stopDiscovery(): Promise<void> {
    if (this.bleEnabled) {
      await BleManager.stopScan();
    }

    if (this.wifiP2PEnabled && Platform.OS === 'android') {
      await WiFiP2PManager.stopPeerDiscovery();
    }
  }

  /**
   * Connect to peer via BLE
   */
  async connectToPeerBLE(peerId: string): Promise<void> {
    try {
      await BleManager.connect(peerId);
      
      // Discover services and characteristics
      const peripheralInfo = await BleManager.retrieveServices(peerId);
      console.log('BLE peer connected:', peripheralInfo);

      this.connectedPeers.add(peerId);

      // Start reading messages
      this.startBLEMessageListener(peerId);
    } catch (error) {
      console.error('BLE connection failed:', error);
      throw error;
    }
  }

  /**
   * Connect to peer via WiFi Direct
   */
  async connectToPeerWiFiDirect(peerAddress: string): Promise<void> {
    if (!this.wifiP2PEnabled || Platform.OS !== 'android') {
      throw new Error('WiFi Direct not available');
    }

    try {
      await WiFiP2PManager.connect(peerAddress);
      console.log('WiFi Direct connected to:', peerAddress);
    } catch (error) {
      console.error('WiFi Direct connection failed:', error);
      throw error;
    }
  }

  /**
   * Send message via BLE
   */
  async sendMessageViaBLE(peerId: string, message: Message): Promise<void> {
    try {
      const messageData = JSON.stringify(message);
      const bytes = this.stringToBytes(messageData);

      // Write to BLE characteristic
      // Note: You need to define your custom BLE service and characteristic UUIDs
      const serviceUUID = 'YOUR_SERVICE_UUID';
      const characteristicUUID = 'YOUR_CHARACTERISTIC_UUID';

      await BleManager.write(
        peerId,
        serviceUUID,
        characteristicUUID,
        bytes
      );

      console.log('Message sent via BLE');
    } catch (error) {
      console.error('BLE message send failed:', error);
      throw error;
    }
  }

  /**
   * Send message via WiFi Direct
   */
  async sendMessageViaWiFiDirect(message: Message): Promise<void> {
    if (!this.wifiP2PEnabled || Platform.OS !== 'android') {
      throw new Error('WiFi Direct not available');
    }

    try {
      const messageData = JSON.stringify(message);
      
      // Send data via WiFi Direct socket
      await WiFiP2PManager.sendMessage(messageData);
      
      console.log('Message sent via WiFi Direct');
    } catch (error) {
      console.error('WiFi Direct message send failed:', error);
      throw error;
    }
  }

  /**
   * Broadcast message to all connected peers
   */
  async broadcastMessage(message: Message): Promise<void> {
    // Send via BLE to all connected peers
    for (const peerId of this.connectedPeers) {
      try {
        await this.sendMessageViaBLE(peerId, message);
      } catch (error) {
        console.error(`Failed to send to ${peerId}:`, error);
      }
    }

    // Send via WiFi Direct if available
    if (this.wifiP2PEnabled && Platform.OS === 'android') {
      try {
        await this.sendMessageViaWiFiDirect(message);
      } catch (error) {
        console.error('WiFi Direct broadcast failed:', error);
      }
    }
  }

  /**
   * Handle BLE peripheral discovered
   */
  private handleBLEPeripheralDiscovered(peripheral: any): void {
    // Check if this is a BlockStar Messenger peer
    if (this.isBlockStarPeer(peripheral)) {
      this.discoveredPeers.set(peripheral.id, peripheral);
      console.log('BlockStar peer discovered:', peripheral.id);

      // Auto-connect if configured
      // this.connectToPeerBLE(peripheral.id);
    }
  }

  /**
   * Handle WiFi Direct peers updated
   */
  private handleWiFiP2PPeersUpdated(peers: any[]): void {
    console.log('WiFi Direct peers:', peers);
    peers.forEach((peer) => {
      this.discoveredPeers.set(peer.deviceAddress, peer);
    });
  }

  /**
   * Handle WiFi Direct connection info
   */
  private handleWiFiP2PConnectionInfo(info: any): void {
    console.log('WiFi Direct connection info:', info);
  }

  /**
   * Start listening for messages from BLE peer
   */
  private startBLEMessageListener(peerId: string): void {
    const serviceUUID = 'YOUR_SERVICE_UUID';
    const characteristicUUID = 'YOUR_CHARACTERISTIC_UUID';

    // Start notifications
    BleManager.startNotification(
      peerId,
      serviceUUID,
      characteristicUUID
    ).then(() => {
      // Listen for updates
      bleEmitter.addListener(
        'BleManagerDidUpdateValueForCharacteristic',
        ({ value, peripheral, characteristic }) => {
          if (peripheral === peerId && characteristic === characteristicUUID) {
            const message = this.bytesToString(value);
            this.handleReceivedMessage(JSON.parse(message));
          }
        }
      );
    });
  }

  /**
   * Handle received message
   */
  private handleReceivedMessage(message: Message): void {
    // Emit event or callback
    console.log('Received mesh message:', message);
  }

  /**
   * Check if peripheral is a BlockStar Messenger peer
   */
  private isBlockStarPeer(peripheral: any): boolean {
    // Check if peripheral advertises BlockStar service UUID
    // or has BlockStar in the name
    return (
      peripheral.name?.includes('BlockStar') ||
      peripheral.advertising?.serviceUUIDs?.includes('YOUR_SERVICE_UUID')
    );
  }

  /**
   * Get discovered peers
   */
  getDiscoveredPeers(): any[] {
    return Array.from(this.discoveredPeers.values());
  }

  /**
   * Get connected peers
   */
  getConnectedPeers(): string[] {
    return Array.from(this.connectedPeers);
  }

  /**
   * Get mesh status
   */
  getStatus(): {
    bleEnabled: boolean;
    wifiP2PEnabled: boolean;
    discoveredPeers: number;
    connectedPeers: number;
  } {
    return {
      bleEnabled: this.bleEnabled,
      wifiP2PEnabled: this.wifiP2PEnabled,
      discoveredPeers: this.discoveredPeers.size,
      connectedPeers: this.connectedPeers.size,
    };
  }

  /**
   * Disconnect from all peers
   */
  async disconnectAll(): Promise<void> {
    // Disconnect BLE
    for (const peerId of this.connectedPeers) {
      try {
        await BleManager.disconnect(peerId);
      } catch (error) {
        console.error(`Failed to disconnect from ${peerId}:`, error);
      }
    }

    // Disconnect WiFi Direct
    if (this.wifiP2PEnabled && Platform.OS === 'android') {
      try {
        await WiFiP2PManager.disconnect();
      } catch (error) {
        console.error('WiFi Direct disconnect failed:', error);
      }
    }

    this.connectedPeers.clear();
  }

  /**
   * Shutdown mesh networking
   */
  async shutdown(): Promise<void> {
    await this.stopDiscovery();
    await this.disconnectAll();
    
    this.discoveredPeers.clear();
    this.messageQueue = [];
  }

  // Helper methods

  private stringToBytes(str: string): number[] {
    return Array.from(Buffer.from(str, 'utf-8'));
  }

  private bytesToString(bytes: number[]): string {
    return Buffer.from(bytes).toString('utf-8');
  }
}

export const mobileMeshService = new MobileMeshService();
