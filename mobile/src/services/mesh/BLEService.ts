// mobile/src/services/mesh/BLEService.ts
import { BleManager, Device, Characteristic } from 'react-native-ble-plx';
import { MeshPeer, MeshMessage } from './MeshNetworkService';

const SERVICE_UUID = '0000FFF0-0000-1000-8000-00805F9B34FB';
const MESSAGE_CHARACTERISTIC_UUID = '0000FFF1-0000-1000-8000-00805F9B34FB';
const PEER_INFO_CHARACTERISTIC_UUID = '0000FFF2-0000-1000-8000-00805F9B34FB';

export class BLEService {
  private manager: BleManager;
  private myPeerId: string = '';
  private connectedDevices: Map<string, Device> = new Map();
  private eventHandlers: Map<string, Function[]> = new Map();
  private isScanning = false;
  private isAdvertising = false;

  constructor() {
    this.manager = new BleManager();
  }

  async initialize(peerId: string): Promise<void> {
    this.myPeerId = peerId;
    
    // Check Bluetooth state
    const state = await this.manager.state();
    console.log('📶 Bluetooth state:', state);

    if (state !== 'PoweredOn') {
      throw new Error('Bluetooth is not powered on');
    }

    // Setup state change listener
    this.manager.onStateChange((newState) => {
      console.log('📶 Bluetooth state changed:', newState);
      if (newState === 'PoweredOff') {
        this.emit('bluetooth-disabled', {});
      } else if (newState === 'PoweredOn') {
        this.emit('bluetooth-enabled', {});
      }
    }, true);
  }

  async startScanning(): Promise<void> {
    if (this.isScanning) {
      console.log('Already scanning');
      return;
    }

    console.log('🔍 Starting BLE scan...');
    this.isScanning = true;

    this.manager.startDeviceScan(
      [SERVICE_UUID],
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          console.error('Scan error:', error);
          return;
        }

        if (device) {
          this.handleDeviceDiscovered(device);
        }
      }
    );
  }

  async stopScanning(): Promise<void> {
    if (!this.isScanning) return;
    
    console.log('⏹️ Stopping BLE scan');
    this.manager.stopDeviceScan();
    this.isScanning = false;
  }

  private async handleDeviceDiscovered(device: Device): Promise<void> {
    console.log('📱 Discovered device:', device.id, device.name);

    try {
      // Connect to device
      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();

      // Read peer info
      const peerInfo = await this.readPeerInfo(connected);
      
      if (peerInfo) {
        this.connectedDevices.set(peerInfo.id, connected);
        
        const peer: MeshPeer = {
          id: peerInfo.id,
          name: peerInfo.name,
          address: device.id,
          rssi: device.rssi || -100,
          type: 'bluetooth',
          connected: true,
          lastSeen: Date.now(),
        };

        this.emit('peer-discovered', peer);

        // Setup message listener
        this.setupMessageListener(connected, peerInfo.id);
      }
    } catch (error) {
      console.error('Error connecting to device:', error);
    }
  }

  private async readPeerInfo(device: Device): Promise<{id: string, name: string} | null> {
    try {
      const characteristic = await device.readCharacteristicForService(
        SERVICE_UUID,
        PEER_INFO_CHARACTERISTIC_UUID
      );

      if (characteristic.value) {
        const decoded = Buffer.from(characteristic.value, 'base64').toString('utf-8');
        return JSON.parse(decoded);
      }
    } catch (error) {
      console.error('Error reading peer info:', error);
    }
    return null;
  }

  private setupMessageListener(device: Device, peerId: string): void {
    device.monitorCharacteristicForService(
      SERVICE_UUID,
      MESSAGE_CHARACTERISTIC_UUID,
      (error, characteristic) => {
        if (error) {
          console.error('Monitor error:', error);
          return;
        }

        if (characteristic?.value) {
          try {
            const decoded = Buffer.from(characteristic.value, 'base64').toString('utf-8');
            const message: MeshMessage = JSON.parse(decoded);
            this.emit('message-received', { peerId, message });
          } catch (err) {
            console.error('Error parsing message:', err);
          }
        }
      }
    );
  }

  async sendMessage(peerId: string, message: MeshMessage): Promise<boolean> {
    const device = this.connectedDevices.get(peerId);
    if (!device) {
      console.error('Device not connected:', peerId);
      return false;
    }

    try {
      const data = JSON.stringify(message);
      const base64 = Buffer.from(data, 'utf-8').toString('base64');

      await device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        MESSAGE_CHARACTERISTIC_UUID,
        base64
      );

      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  }

  async broadcast(message: MeshMessage): Promise<void> {
    const promises = Array.from(this.connectedDevices.keys()).map(peerId =>
      this.sendMessage(peerId, message)
    );
    await Promise.all(promises);
  }

  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  off(event: string, handler: Function): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  getConnectedPeers(): MeshPeer[] {
    return Array.from(this.connectedDevices.entries()).map(([id, device]) => ({
      id,
      name: device.name || 'Unknown',
      address: device.id,
      rssi: device.rssi || -100,
      type: 'bluetooth' as const,
      connected: true,
      lastSeen: Date.now(),
    }));
  }

  isConnected(peerId: string): boolean {
    return this.connectedDevices.has(peerId);
  }

  disconnect(peerId: string): void {
    const device = this.connectedDevices.get(peerId);
    if (device) {
      device.cancelConnection();
      this.connectedDevices.delete(peerId);
    }
  }

  async destroy(): Promise<void> {
    await this.stopScanning();
    
    // Disconnect all devices
    for (const [peerId, device] of this.connectedDevices) {
      await device.cancelConnection();
    }
    
    this.connectedDevices.clear();
    await this.manager.destroy();
  }
}
