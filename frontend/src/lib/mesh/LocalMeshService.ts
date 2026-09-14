// frontend/src/lib/mesh/LocalMeshService.ts
// Same-Wi-Fi auto-connect: everyone on one network (or one phone's hotspot)
// discovers each other via NSD/mDNS and connects over local TCP, then messages
// / calls / walkie-talkie all ride the existing mesh.
//
// Requires: LocalMeshPlugin.java registered in MainActivity + Patch 02.
// Android-first (iOS: swap in a Bonjour/NWListener plugin with the same JS API).
//
// STATUS: working scaffold — pairs with LocalMeshPlugin.java. Test on devices.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { meshNetworkService } from './MeshNetworkService';

interface LocalMeshPluginI {
  register(o: { address: string; port?: number }): Promise<{ port: number }>;
  discover(): Promise<void>;
  stopDiscovery(): Promise<void>;
  connect(o: { host: string; port: number; name?: string }): Promise<{ connectionId: string }>;
  send(o: { connectionId: string; message: string }): Promise<void>;
  broadcast(o: { message: string }): Promise<void>;
  disconnect(o: { connectionId: string }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: string, cb: (data: any) => void): Promise<{ remove: () => Promise<void> }>;
}

const LocalMesh = registerPlugin<LocalMeshPluginI>('LocalMesh');

interface Hello {
  __lmhello: 1;
  address: string;
  publicKey: string;
  username?: string;
}

class LocalMeshService {
  private started = false;
  private listeners: Array<{ remove: () => Promise<void> }> = [];

  // connectionId <-> wallet address bookkeeping
  private connToAddr = new Map<string, string>();
  private addrToConn = new Map<string, string>();
  private knownServiceAddrs = new Set<string>(); // dedupe discovered peers

  isSupported(): boolean {
    return Capacitor.isNativePlatform();
  }

  async start(): Promise<boolean> {
    if (this.started) return true;
    if (!this.isSupported()) return false;

    const id = meshNetworkService.getIdentity();
    if (!id.walletAddress) {
      console.warn('🌐 [LocalMesh] mesh not initialized yet');
      return false;
    }

    // Wire native events
    this.listeners.push(
      await LocalMesh.addListener('peerFound', (d) => this.onPeerFound(d))
    );
    this.listeners.push(
      await LocalMesh.addListener('peerLost', () => {/* NSD churn; connections self-heal */})
    );
    this.listeners.push(
      await LocalMesh.addListener('connected', (d) => this.onConnected(d.connectionId))
    );
    this.listeners.push(
      await LocalMesh.addListener('disconnected', (d) => this.onDisconnected(d.connectionId))
    );
    this.listeners.push(
      await LocalMesh.addListener('messageReceived', (d) => this.onMessage(d.connectionId, d.message))
    );

    await LocalMesh.register({ address: id.walletAddress });
    await LocalMesh.discover();

    this.started = true;
    console.log('🌐 [LocalMesh] Started; advertising + discovering on LAN');
    return true;
  }

  async stop(): Promise<void> {
    for (const l of this.listeners) await l.remove();
    this.listeners = [];
    for (const addr of this.addrToConn.keys()) meshNetworkService.unregisterExternalPeer(addr);
    this.connToAddr.clear();
    this.addrToConn.clear();
    this.knownServiceAddrs.clear();
    try { await LocalMesh.stop(); } catch {/* noop */}
    this.started = false;
  }

  // ------------------------------------------------------------------

  private async onPeerFound(d: { name: string; host: string; port: number; address?: string }): Promise<void> {
    // Prefer the TXT/address; fall back to parsing the Bonjour instance name.
    let addr = (d.address || '').toLowerCase();
    if (!addr && d.name?.startsWith('bscypher-')) addr = d.name.slice('bscypher-'.length).toLowerCase();
    const me = meshNetworkService.getIdentity().walletAddress;
    if (addr && addr === me) return;               // self
    if (addr && this.addrToConn.has(addr)) return; // already connected
    if (addr && this.knownServiceAddrs.has(addr)) return;
    if (addr) this.knownServiceAddrs.add(addr);

    // Deterministic dial rule so both sides don't connect twice:
    // only the lexicographically-smaller address initiates.
    if (addr && me && me < addr) {
      // We'll wait for THEM to dial us.
      return;
    }

    try {
      const { connectionId } = await LocalMesh.connect({ host: d.host, port: d.port, name: d.name });
      // hello is sent on 'connected'
      console.log('🌐 [LocalMesh] Dialed', d.host, '->', connectionId);
    } catch (e) {
      console.warn('🌐 [LocalMesh] connect failed', e);
      if (addr) this.knownServiceAddrs.delete(addr);
    }
  }

  private onConnected(connectionId: string): void {
    // Introduce ourselves so the peer can map connectionId -> wallet address
    const id = meshNetworkService.getIdentity();
    const hello: Hello = {
      __lmhello: 1,
      address: id.walletAddress,
      publicKey: id.publicKey,
      username: id.username,
    };
    void LocalMesh.send({ connectionId, message: JSON.stringify(hello) });
  }

  private onDisconnected(connectionId: string): void {
    const addr = this.connToAddr.get(connectionId);
    if (addr) {
      meshNetworkService.unregisterExternalPeer(addr);
      this.addrToConn.delete(addr);
      this.knownServiceAddrs.delete(addr);
    }
    this.connToAddr.delete(connectionId);
  }

  private onMessage(connectionId: string, message: string): void {
    // hello?
    try {
      const maybe = JSON.parse(message);
      if (maybe && maybe.__lmhello === 1) {
        this.linkPeer(connectionId, maybe as Hello);
        return;
      }
    } catch {/* not a hello */}

    const addr = this.connToAddr.get(connectionId);
    if (addr) meshNetworkService.ingestExternalMessage(message, addr);
  }

  private linkPeer(connectionId: string, hello: Hello): void {
    const addr = hello.address.toLowerCase();
    this.connToAddr.set(connectionId, addr);
    this.addrToConn.set(addr, connectionId);

    meshNetworkService.registerExternalPeer(
      {
        walletAddress: addr,
        publicKey: hello.publicKey,
        username: hello.username,
        connectionType: 'local',
      },
      (rawMsg: string) => {
        void LocalMesh.send({ connectionId, message: rawMsg });
      }
    );
    console.log('🌐 [LocalMesh] Linked LAN peer:', hello.username || addr);
  }
}

export const localMeshService = new LocalMeshService();
