// frontend/src/lib/groupCallMesh.ts
// Full-mesh group calls.
//
// How a call forms:
//   1. The initiator offers to every member (peerId = `${callId}-${member}`).
//   2. A member answers the initiator over that peer, then the server sends
//      them a roster of members who have ALREADY joined.
//   3. The newcomer opens a peer to each of those members
//      (peerId = `${callId}~${a}~${b}`, addresses sorted) and offers; the
//      existing member answers. Signals are relayed via `group:call:mesh:signal`.
// So every pair of people in the call has exactly one connection and everyone
// hears everyone. The newcomer always makes the offer, so there's no glare.

import { webRTCService } from './webrtc';
import { webSocketService } from './websocket';

interface BeginOpts {
  callId: string;
  me: string;
  initiator: string;
  audioOnly: boolean;
}

class GroupCallMesh {
  callId: string | null = null;
  me = '';
  initiator = '';
  audioOnly = true;

  private peerToAddress = new Map<string, string>();
  private unsubs: Array<() => void> = [];

  /** Start tracking a group call (idempotent for the same callId). */
  begin({ callId, me, initiator, audioOnly }: BeginOpts): void {
    if (this.callId === callId) return;
    this.end();
    this.callId = callId;
    this.me = me.toLowerCase();
    this.initiator = initiator.toLowerCase();
    this.audioOnly = audioOnly;

    this.unsubs.push(
      webSocketService.on('group:call:roster', (data: any) => this.onRoster(data)),
      webSocketService.on('group:call:mesh:signal', (data: any) => this.onMeshSignal(data)),
      webSocketService.on('group:call:participant:left', (data: any) => this.onLeft(data)),
    );
  }

  /** Stop tracking (call ended / left). Peers are destroyed by webRTCService.cleanup(). */
  end(): void {
    this.unsubs.forEach((u) => { try { u(); } catch {} });
    this.unsubs = [];
    this.peerToAddress.clear();
    this.callId = null;
  }

  isActive(callId?: string): boolean {
    return !!this.callId && (!callId || this.callId === callId);
  }

  registerPeer(peerId: string, address: string): void {
    this.peerToAddress.set(peerId, address.toLowerCase());
  }

  /** Which participant a peer connection belongs to. */
  addressForPeer(peerId: string): string | undefined {
    const known = this.peerToAddress.get(peerId);
    if (known) return known;
    // Legacy star ids: `${callId}-${address}`
    const last = peerId.split('-').pop()?.toLowerCase();
    if (!last || !/^0x[0-9a-f]{40}$/.test(last)) return undefined;
    // As a member, our link to the initiator is named after US
    return last === this.me ? this.initiator : last;
  }

  peerIdsFor(address: string): string[] {
    const a = address.toLowerCase();
    return [...this.peerToAddress.entries()].filter(([, v]) => v === a).map(([k]) => k);
  }

  private pairPeerId(other: string): string {
    const [x, y] = [this.me, other.toLowerCase()].sort();
    return `${this.callId}~${x}~${y}`;
  }

  private send(toAddress: string, peerId: string, signal: any): void {
    webSocketService.emit('group:call:mesh:signal', {
      callId: this.callId,
      toAddress,
      peerId,
      signal,
    });
  }

  /** Newcomer → existing member: open a peer and offer. */
  private connectTo(address: string): void {
    const other = address.toLowerCase();
    if (!this.callId || other === this.me || other === this.initiator) return;
    if (this.peerIdsFor(other).some((id) => webRTCService.hasPeer(id))) return;

    const peerId = this.pairPeerId(other);
    this.registerPeer(peerId, other);
    console.log(`🕸️ Mesh: connecting to ${other} (${peerId})`);
    try {
      webRTCService.createCall(peerId, this.audioOnly, (signal) => this.send(other, peerId, signal));
    } catch (err) {
      console.error('Mesh: could not create peer', err);
    }
  }

  private onRoster(data: any): void {
    if (!data || data.callId !== this.callId) return;
    const peers: string[] = Array.isArray(data.peers) ? data.peers : [];
    console.log('🕸️ Mesh roster:', peers);
    peers.forEach((p) => this.connectTo(p));
  }

  private onMeshSignal(data: any): void {
    if (!data || data.callId !== this.callId || !data.peerId || !data.signal) return;
    const { peerId, signal } = data;
    const from = String(data.from || '').toLowerCase();
    if (!from) return;

    if (!webRTCService.hasPeer(peerId)) {
      if (signal.type === 'offer') {
        // Existing member: a newcomer is offering — answer it
        this.registerPeer(peerId, from);
        console.log(`🕸️ Mesh: answering ${from} (${peerId})`);
        try {
          webRTCService.answerCall(peerId, this.audioOnly, (sig) => this.send(from, peerId, sig));
          webRTCService.processSignal(peerId, signal);
        } catch (err) {
          console.error('Mesh: could not answer peer', err);
        }
      } else {
        // ICE arrived before the offer — queue it
        webRTCService.addIceCandidate(peerId, signal);
      }
      return;
    }

    if (signal.type === 'offer' || signal.type === 'answer') {
      webRTCService.processSignal(peerId, signal);
    } else {
      webRTCService.addIceCandidate(peerId, signal);
    }
  }

  private onLeft(data: any): void {
    if (!data || data.callId !== this.callId) return;
    const who = String(data.participantAddress || data.address || '').toLowerCase();
    if (!who) return;
    for (const id of this.peerIdsFor(who)) {
      webRTCService.closePeer(id);
      this.peerToAddress.delete(id);
    }
  }
}

export const groupCallMesh = new GroupCallMesh();
