// frontend/src/lib/mesh/meshChat.ts
// End-to-end encrypted text chat over the mesh.
//
// Why this exists:
//  - Mesh text messages were sent in PLAINTEXT (MeshNetworkService had
//    `encrypted: false // TODO`). Mesh relays messages across other phones, so any
//    phone in the middle of a route could read them.
//  - The normal chat path (encryptionService.encryptForRecipient) fetches the
//    recipient's key from the server. Offline that fetch fails and it silently falls
//    back to plaintext — unusable for mesh.
//
// So mesh chat encrypts with the SAME X25519 + AES-GCM scheme as normal chat, but
// using the public key the peer shared during the mesh handshake. No server needed.
// If no key is available the message is NOT sent (never falls back to plaintext).
//
// It also keeps conversations for the whole session (the old Messages tab lost them
// whenever the modal closed) and ignores protocol/voice traffic (ack, ping, voice…).

import { meshNetworkService, MeshMessage } from './MeshNetworkService';
import { encryptionService } from '@/lib/encryption';

export interface MeshChatMessage {
  id: string;
  /** The other party (lowercase wallet address) */
  peer: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  outgoing: boolean;
  status: 'sending' | 'sent' | 'queued' | 'failed' | 'received';
  encrypted: boolean;
  /** Relays the message passed through (0 = direct) */
  relays: number;
  /** Shown under the bubble, e.g. "Not encrypted" or a failure reason */
  note?: string;
}

export interface MeshConversation {
  peer: string;
  last: MeshChatMessage;
  count: number;
}

// Envelope carried in MeshMessage.content for encrypted text
interface Envelope {
  bsm: 1; // BlockStar secure mesh, v1
  ct: string; // ciphertext (encryptionService.encryptMessage output)
  spk: string; // sender's public key (used when the sender isn't a direct peer)
}

const MAX_MESSAGES = 500;
const SERVER_KEY_CHECK_MS = 1500;

function isEnvelope(x: any): x is Envelope {
  return x && x.bsm === 1 && typeof x.ct === 'string' && typeof x.spk === 'string';
}

/** True if `key` is a base64 X25519 public key (exactly 32 bytes). */
function isValidKey(key: string | null | undefined): key is string {
  if (!key) return false;
  try {
    let k = key;
    if (k.length % 4) k += '='.repeat(4 - (k.length % 4));
    return atob(k).length === 32;
  } catch {
    return false;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

class MeshChatStore {
  private me = '';
  private messages: MeshChatMessage[] = [];
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;

  // ─── lifecycle ───

  /** Idempotent. Call once the mesh is initialized for the logged-in wallet. */
  start(myAddress: string): void {
    const addr = (myAddress || '').toLowerCase();
    if (!addr) return;
    if (addr !== this.me) {
      // Different user (e.g. after logout/login): drop the previous session's chats
      this.messages = [];
      this.me = addr;
      this.emit();
    }
    if (this.unsubscribe) return;
    this.unsubscribe = meshNetworkService.onMessage((message) => {
      if (message.type !== 'text') return; // ignore ack/ping/voice/discovery/etc.
      void this.receive(message);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.messages = [];
    this.me = '';
    this.emit();
  }

  // ─── subscriptions ───

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error('[MeshChat] listener error', e);
      }
    });
  }

  getConversation(peer: string): MeshChatMessage[] {
    const p = peer.toLowerCase();
    return this.messages.filter((m) => m.peer === p);
  }

  getConversations(): MeshConversation[] {
    const map = new Map<string, MeshConversation>();
    for (const m of this.messages) {
      const c = map.get(m.peer);
      if (!c) map.set(m.peer, { peer: m.peer, last: m, count: 1 });
      else {
        c.count++;
        if (m.timestamp >= c.last.timestamp) c.last = m;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.last.timestamp - a.last.timestamp);
  }

  private add(msg: MeshChatMessage): void {
    this.messages.push(msg);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    this.emit();
  }

  private update(id: string, patch: Partial<MeshChatMessage>): void {
    const m = this.messages.find((x) => x.id === id);
    if (m) {
      Object.assign(m, patch);
      this.emit();
    }
  }

  // ─── keys ───

  private peerKeyFromMesh(address: string): string | null {
    const a = address.toLowerCase();
    const peer = meshNetworkService.getAllPeers().find((p) => p.walletAddress.toLowerCase() === a);
    return peer?.publicKey || null;
  }

  // ─── send ───

  async send(peerAddress: string, text: string): Promise<void> {
    const to = peerAddress.toLowerCase();
    const body = text.trim();
    if (!body) return;

    const local: MeshChatMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      peer: to,
      from: this.me,
      to,
      text: body,
      timestamp: Date.now(),
      outgoing: true,
      status: 'sending',
      encrypted: true,
      relays: 0,
    };
    this.add(local);

    const fail = (note: string) => this.update(local.id, { status: 'failed', note });

    if (!encryptionService.isReady()) {
      fail('Encryption is not ready yet — try again in a moment.');
      return;
    }

    const meshKey = this.peerKeyFromMesh(to);
    if (!meshKey) {
      fail("This person's encryption key isn't known yet. Connect to them directly first.");
      return;
    }
    if (!isValidKey(meshKey)) {
      fail('This connection was made with an older app version. Update both phones, then reconnect with a new QR code.');
      return;
    }

    // If we're online (or have the key cached), make sure the key the peer gave us
    // over the mesh matches their registered key. A mismatch means someone may be
    // impersonating them, so refuse to send.
    const registered = await withTimeout(encryptionService.fetchPublicKey(to), SERVER_KEY_CHECK_MS, null);
    if (registered && registered !== meshKey) {
      fail("Security warning: this peer's key doesn't match their registered key. Message not sent.");
      return;
    }

    try {
      const ct = await encryptionService.encryptMessage(body, meshKey);
      const spk = await encryptionService.getPublicKey();
      const envelope: Envelope = { bsm: 1, ct, spk };
      const res = await meshNetworkService.sendMessage(to, JSON.stringify(envelope), 'text', {
        encrypted: true,
      });
      if (res.sent) this.update(local.id, { status: 'sent' });
      else if (res.queued) this.update(local.id, { status: 'queued', note: 'Will be delivered when a route is available' });
      else fail(res.error || 'Could not send');
    } catch (e: any) {
      fail(e?.message || 'Encryption failed');
    }
  }

  // ─── receive ───

  private async receive(message: MeshMessage): Promise<void> {
    const from = message.from.toLowerCase();
    const base: MeshChatMessage = {
      id: message.id,
      peer: from,
      from,
      to: message.to.toLowerCase(),
      text: '',
      timestamp: message.timestamp || Date.now(),
      outgoing: false,
      status: 'received',
      encrypted: false,
      relays: Math.max(0, (message.hops?.length || 1) - 1),
    };

    let env: any = null;
    try {
      env = JSON.parse(message.content);
    } catch {
      /* not JSON */
    }

    if (!isEnvelope(env)) {
      // Plaintext from an older app version — show it, clearly flagged.
      this.add({ ...base, text: message.content, note: 'Not encrypted (sent from an older app version)' });
      return;
    }

    // Prefer the key from a direct mesh connection; fall back to the envelope key
    // (needed when the sender is several hops away).
    const meshKey = this.peerKeyFromMesh(from);
    const key = isValidKey(meshKey) ? meshKey : env.spk;
    try {
      const text = await encryptionService.decryptMessage(env.ct, key);
      this.add({ ...base, text, encrypted: true });
    } catch {
      this.add({
        ...base,
        text: '🔒 Could not decrypt this message',
        encrypted: true,
        note: 'The sender may have reset their keys',
      });
    }
  }
}

export const meshChat = new MeshChatStore();
