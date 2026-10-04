// frontend/src/store/blockStore.ts
// Users the current account has blocked. Server is the source of truth
// (it drops DMs and calls from blocked users); this store drives the UI and
// acts as a second filter on the client.
import { create } from 'zustand';

const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

export interface BlockedUser {
  walletAddress: string;
  blockedAt: number;
}

interface BlockState {
  owner: string | null;
  blocked: BlockedUser[];
  loaded: boolean;
  load: (ownerWallet: string) => Promise<void>;
  block: (ownerWallet: string, targetWallet: string) => Promise<boolean>;
  unblock: (ownerWallet: string, targetWallet: string) => Promise<boolean>;
  isBlocked: (wallet?: string | null) => boolean;
  reset: () => void;
}

export const useBlockStore = create<BlockState>((set, get) => ({
  owner: null,
  blocked: [],
  loaded: false,

  load: async (ownerWallet) => {
    const owner = ownerWallet.toLowerCase();
    try {
      const res = await fetch(`${API_URL}/api/blocks/${owner}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ owner, blocked: data.blocked || [], loaded: true });
    } catch (err) {
      console.error('Failed to load blocked users:', err);
      set({ owner, loaded: true });
    }
  },

  block: async (ownerWallet, targetWallet) => {
    const owner = ownerWallet.toLowerCase();
    const target = targetWallet.toLowerCase();
    if (owner === target) return false;
    try {
      const res = await fetch(`${API_URL}/api/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockerWallet: owner, blockedWallet: target }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set((s) => ({
        blocked: s.blocked.some((b) => b.walletAddress === target)
          ? s.blocked
          : [{ walletAddress: target, blockedAt: Date.now() }, ...s.blocked],
      }));
      return true;
    } catch (err) {
      console.error('Failed to block user:', err);
      return false;
    }
  },

  unblock: async (ownerWallet, targetWallet) => {
    const owner = ownerWallet.toLowerCase();
    const target = targetWallet.toLowerCase();
    try {
      const res = await fetch(`${API_URL}/api/blocks/${owner}/${target}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set((s) => ({ blocked: s.blocked.filter((b) => b.walletAddress !== target) }));
      return true;
    } catch (err) {
      console.error('Failed to unblock user:', err);
      return false;
    }
  },

  isBlocked: (wallet) => {
    if (!wallet) return false;
    const w = wallet.toLowerCase();
    return get().blocked.some((b) => b.walletAddress === w);
  },

  reset: () => set({ owner: null, blocked: [], loaded: false }),
}));
