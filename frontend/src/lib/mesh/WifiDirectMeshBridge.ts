// frontend/src/lib/mesh/WifiDirectMeshBridge.ts
// Wires the (previously orphaned) native WiFi Direct plugin into the mesh.
//
// Requires:
//   - Patch 01 (register WifiDirectPlugin in MainActivity)
//   - Patch 02 (MeshNetworkService.getIdentity / ingestExternalMessage /
//               registerExternalPeer / unregisterExternalPeer)
//
// Android-only. iOS has no Wi-Fi P2P API — see README for the Multipeer path.
//
// The native plugin gives us a single group-owner<->client string pipe on port
// 8988. This bridge:
//   1. runs discovery,
//   2. connects to a chosen peer,
//   3. after the socket forms, does a tiny hello handshake to learn the peer's
//      wallet address, registers it as an external mesh peer,
//   4. relays every mesh-message string across the WiFi Direct socket and feeds
//      incoming strings back into the mesh via ingestExternalMessage().

import { Capacitor } from '@capacitor/core';
import { wifiDirectService, WifiDirectPeer } from './WifiDirectService';
import { meshNetworkService } from './MeshNetworkService';

interface Hello {
  __wdhello: 1;
  walletAddress: string;
  publicKey: string;
  username?: string;
}

class WifiDirectMeshBridge {
  private started = false;
  private peerAddress: string | null = null; // wallet address of the linked peer
  private unsubscribers: Array<() => void> = [];

  isSupported(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  async start(): Promise<boolean> {
    if (this.started) return true;
    if (!this.isSupported()) {
      console.log('📶 [WDBridge] WiFi Direct bridge is Android-only');
      return false;
    }

    const available = await wifiDirectService.initialize();
    if (!available) {
      console.warn('📶 [WDBridge] WiFi Direct not available on this device');
      return false;
    }

    await wifiDirectService.requestPermissions();

    // Incoming socket data -> either a hello, or a mesh-message string
    this.unsubscribers.push(
      wifiDirectService.on('messageReceived', (data: any) => {
        const raw: string = typeof data === 'string' ? data : data?.message;
        if (!raw) return;
        this.onSocketData(raw);
      })
    );

    // When the P2P group forms, send our hello so the peer learns who we are
    this.unsubscribers.push(
      wifiDirectService.on('connectionChanged', (info: any) => {
        if (info?.connected) {
          this.sendHello();
        } else {
          this.teardownPeer();
        }
      })
    );

    await wifiDirectService.startDiscovery();
    this.started = true;
    console.log('📶 [WDBridge] Started');
    return true;
  }

  async stop(): Promise<void> {
    this.teardownPeer();
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    await wifiDirectService.destroy();
    this.started = false;
  }

  /** List peers the OS has discovered. */
  async getPeers(): Promise<WifiDirectPeer[]> {
    return wifiDirectService.refreshPeers();
  }

  /** Connect to a discovered peer by its device MAC address. */
  async connectTo(deviceAddress: string): Promise<boolean> {
    return wifiDirectService.connect(deviceAddress);
  }

  // ------------------------------------------------------------------

  private sendHello(): void {
    const id = meshNetworkService.getIdentity();
    const hello: Hello = {
      __wdhello: 1,
      walletAddress: id.walletAddress,
      publicKey: id.publicKey,
      username: id.username,
    };
    void wifiDirectService.sendMessage(JSON.stringify(hello));
  }

  private onSocketData(raw: string): void {
    // Is it a hello?
    try {
      const maybe = JSON.parse(raw);
      if (maybe && maybe.__wdhello === 1) {
        this.linkPeer(maybe as Hello);
        return;
      }
    } catch {
      /* not JSON we recognize as hello — fall through */
    }

    // Otherwise treat it as a mesh-message string from the linked peer
    if (this.peerAddress) {
      meshNetworkService.ingestExternalMessage(raw, this.peerAddress);
    }
  }

  private linkPeer(hello: Hello): void {
    const addr = hello.walletAddress.toLowerCase();
    this.peerAddress = addr;
    meshNetworkService.registerExternalPeer(
      {
        walletAddress: addr,
        publicKey: hello.publicKey,
        username: hello.username,
        connectionType: 'wifi-direct',
      },
      // sendFn: push raw mesh strings across the WiFi Direct socket
      (rawMsg: string) => {
        void wifiDirectService.sendMessage(rawMsg);
      }
    );
    console.log('📶 [WDBridge] Linked WiFi Direct peer:', hello.username || addr);
  }

  private teardownPeer(): void {
    if (this.peerAddress) {
      meshNetworkService.unregisterExternalPeer(this.peerAddress);
      this.peerAddress = null;
    }
  }
}

export const wifiDirectMeshBridge = new WifiDirectMeshBridge();
