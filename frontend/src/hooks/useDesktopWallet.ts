'use client';

/**
 * useDesktopWallet — wallet connect + sign for DESKTOP builds, without a phone.
 *
 * Desktop apps have no wallet extension inside them, so we open a hosted page
 * (wallet-auth.html / wallet-sign.html) in a real browser where the wallet lives,
 * and that page calls back into the app:
 *
 *   Electron (Windows/macOS/Linux)  -> callback to a localhost server (port 47391)
 *   iOS app on Mac (TestFlight)     -> callback to blockstarcypher://wallet/...
 *
 * Where the page opens (the "target"):
 *   'blockstar' -> BlockStar Browser (built-in BlockStar Wallet)
 *   'browser'   -> the user's default browser (MetaMask, Rabby, Coinbase, ...)
 *   'link'      -> user copied the link and opened it in a browser of their choice
 *
 * Mobile-wallet QR connect is NOT handled here: on desktop the QR option uses
 * ConnectKit/wagmi in-app (WalletConnect relay works fine on desktop).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { isAddress, recoverMessageAddress } from 'viem';
import {
  detectPlatform,
  getCachedPlatform,
  hasElectronBridge,
  isDesktopKind,
  looksLikeElectron,
  PlatformInfo,
  type PlatformKind,
} from '@/lib/platform';

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const AUTH_PAGE_URL =
  process.env.NEXT_PUBLIC_WALLET_AUTH_URL || 'https://messenger.blockstar.world/walletauth';
const SIGN_PAGE_URL =
  process.env.NEXT_PUBLIC_WALLET_SIGN_URL || 'https://messenger.blockstar.world/walletsign';
// Decimal chain id (was previously parsed as hex by mistake -> 21778).
const DEFAULT_CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '5512', 10) || 5512;

const BLOCKSTAR_BROWSER_SCHEME = 'blockstarbrowser';
const APP_CALLBACK_SCHEME = 'blockstarcypher'; // registered in iOS Info.plist
const TIMEOUT_MS = 5 * 60 * 1000;
const STORAGE_KEY = 'desktop_wallet';

export type DesktopWalletTarget = 'blockstar' | 'browser' | 'link';

// ═══════════════════════════════════════════════════════════════
// ELECTRON BRIDGE
// ═══════════════════════════════════════════════════════════════

interface ElectronAPI {
  isElectron: boolean;
  walletOpenBrowser: (url: string) => Promise<{ success: boolean; error?: string }>;
  walletOpenBlockStar?: (
    url: string
  ) => Promise<{ success: boolean; installed: boolean; error?: string }>;
  walletStartServer: () => Promise<{ port: number | null; error?: string }>;
  walletStopServer: () => Promise<{ success: boolean }>;
  onWalletConnected: (cb: (data: any) => void) => () => void;
  onWalletCancelled: (cb: () => void) => () => void;
  onWalletSigned: (cb: (data: any) => void) => () => void;
  clipboardWrite?: (text: string) => Promise<{ success: boolean }>;
}

function getElectronAPI(): ElectronAPI | null {
  return hasElectronBridge() ? ((window as any).electronAPI as ElectronAPI) : null;
}

/**
 * Backward-compatible synchronous check used elsewhere (e.g. Sidebar).
 * True for Electron and for the iOS app running on a Mac.
 */
export function isDesktopApp(): boolean {
  return hasElectronBridge() || looksLikeElectron() || getCachedPlatform() === 'ios-on-mac';
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function blockstarBrowserUrl(targetUrl: string): string {
  return `${BLOCKSTAR_BROWSER_SCHEME}://open?url=${encodeURIComponent(targetUrl)}`;
}

async function copyText(text: string): Promise<boolean> {
  const api = getElectronAPI();
  if (api?.clipboardWrite) {
    try {
      await api.clipboardWrite(text);
      return true;
    } catch {
      /* fall through */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type PendingKind = 'connect' | 'sign';

interface Pending {
  kind: PendingKind;
  id: string;
  message?: string;
  resolve: (value: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Saved {
  address: string;
  rdns?: string;
  target?: DesktopWalletTarget;
}

// ═══════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════

export function useDesktopWallet() {
  const [platform, setPlatform] = useState<PlatformKind | null>(getCachedPlatform());
  const [address, setAddress] = useState<string | undefined>(undefined);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockstarMissing, setBlockstarMissing] = useState(false);

  const pendingRef = useRef<Pending | null>(null);
  const savedRef = useRef<Saved | null>(null);
  const addressRef = useRef<string | undefined>(undefined);
  addressRef.current = address;

  const isDesktop = isDesktopKind(platform);

  // ─── Detect platform + restore saved connection ───
  useEffect(() => {
    let cancelled = false;
    detectPlatform().then((kind) => {
      if (cancelled) return;
      setPlatform(kind);
      if (!isDesktopKind(kind)) return;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const data: Saved = JSON.parse(raw);
          if (data.address && isAddress(data.address)) {
            savedRef.current = data;
            setAddress(data.address);
            setIsConnected(true);
          }
        }
      } catch (e) {
        console.error('[DesktopWallet] Failed to restore:', e);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Finish / fail the pending operation ───
  const settle = useCallback(async (ok: boolean, value: string | Error) => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    clearTimeout(p.timer);
    setIsConnecting(false);
    setIsSigning(false);
    setPendingUrl(null);
    getElectronAPI()?.walletStopServer().catch(() => {});
    if (ok) p.resolve(value as string);
    else p.reject(value as Error);
  }, []);

  // ─── Handle a callback from the hosted page ───
  const handleCallback = useCallback(
    async (route: 'connected' | 'signed' | 'cancel', params: URLSearchParams) => {
      const p = pendingRef.current;
      if (!p) return;

      if (route === 'cancel') {
        setError('Cancelled in browser');
        await settle(false, new Error('User cancelled'));
        return;
      }

      if (route === 'connected' && p.kind === 'connect') {
        if (params.get('session') !== p.id) return; // not ours
        const addr = params.get('address') || '';
        if (!isAddress(addr)) {
          setError('Wallet returned an invalid address');
          await settle(false, new Error('Invalid address'));
          return;
        }
        const saved: Saved = {
          address: addr,
          rdns: params.get('rdns') || undefined,
          target: savedRef.current?.target,
        };
        savedRef.current = saved;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        setAddress(addr);
        setIsConnected(true);
        setError(null);
        await settle(true, addr);
        return;
      }

      if (route === 'signed' && p.kind === 'sign') {
        if (params.get('signId') !== p.id) return; // not ours
        const signature = params.get('signature');
        if (!signature) {
          const msg = params.get('error') || 'Signing failed';
          setError(msg);
          await settle(false, new Error(msg));
          return;
        }
        // Only accept a signature that really comes from the connected wallet.
        // The encryption keys are derived from it, so this must not be forgeable.
        try {
          const recovered = await recoverMessageAddress({
            message: p.message || '',
            signature: signature as `0x${string}`,
          });
          if (recovered.toLowerCase() !== (addressRef.current || '').toLowerCase()) {
            const msg = `Signed with a different account (${recovered.slice(0, 8)}…). Switch to the connected account and try again.`;
            setError(msg);
            await settle(false, new Error(msg));
            return;
          }
        } catch {
          setError('Invalid signature returned');
          await settle(false, new Error('Invalid signature'));
          return;
        }
        setError(null);
        await settle(true, signature);
      }
    },
    [settle]
  );

  // ─── Listen for callbacks (transport depends on platform) ───
  useEffect(() => {
    if (!isDesktop) return;

    // Electron: IPC from the localhost callback server
    const api = getElectronAPI();
    if (api) {
      const offConnected = api.onWalletConnected((d) =>
        handleCallback('connected', new URLSearchParams({
          address: d?.address || '',
          session: d?.session || '',
          rdns: d?.rdns || '',
        }))
      );
      const offSigned = api.onWalletSigned((d) =>
        handleCallback('signed', new URLSearchParams({
          signId: d?.signId || '',
          signature: d?.signature || '',
          error: d?.error || '',
        }))
      );
      const offCancelled = api.onWalletCancelled(() =>
        handleCallback('cancel', new URLSearchParams())
      );
      return () => {
        offConnected();
        offSigned();
        offCancelled();
      };
    }

    // iOS app on Mac: blockstarcypher://wallet/<route>?...
    if (platform === 'ios-on-mac') {
      let remove: (() => void) | undefined;
      let disposed = false;
      import('@capacitor/app').then(({ App }) => {
        App.addListener('appUrlOpen', ({ url }) => {
          try {
            const u = new URL(url);
            if (u.protocol !== `${APP_CALLBACK_SCHEME}:`) return;
            // blockstarcypher://wallet/connected -> host "wallet", path "/connected"
            const route = u.pathname.replace(/^\/+/, '') as 'connected' | 'signed' | 'cancel';
            if (u.hostname !== 'wallet') return;
            if (route === 'connected' || route === 'signed' || route === 'cancel') {
              handleCallback(route, u.searchParams);
            }
          } catch (e) {
            console.warn('[DesktopWallet] Bad callback URL', url, e);
          }
        }).then((handle) => {
          if (disposed) handle.remove();
          else remove = () => handle.remove();
        });
      });
      return () => {
        disposed = true;
        remove?.();
      };
    }
  }, [isDesktop, platform, handleCallback]);

  // ─── Callback URLs for the current transport ───
  const getCallbacks = useCallback(async () => {
    const api = getElectronAPI();
    if (api) {
      const r = await api.walletStartServer();
      if (!r.port) throw new Error(r.error || 'Could not start the local callback server');
      const base = `http://127.0.0.1:${r.port}`;
      return {
        connect: `${base}/callback`,
        sign: `${base}/sign-callback`,
        cancel: `${base}/cancel`,
      };
    }
    if (platform === 'ios-on-mac') {
      const base = `${APP_CALLBACK_SCHEME}://wallet`;
      return { connect: `${base}/connected`, sign: `${base}/signed`, cancel: `${base}/cancel` };
    }
    if (looksLikeElectron()) {
      throw new Error(
        'The desktop wallet bridge did not load. Please reinstall or update BlockStar Cypher. You can still connect with the mobile wallet (QR) option.'
      );
    }
    throw new Error('Desktop wallet flow is not available on this platform');
  }, [platform]);

  // ─── Open a URL in the chosen target ───
  const openInTarget = useCallback(
    async (url: string, target: DesktopWalletTarget): Promise<void> => {
      setBlockstarMissing(false);
      if (target === 'link') return; // user will open it themselves

      const api = getElectronAPI();
      if (target === 'blockstar') {
        if (api?.walletOpenBlockStar) {
          const r = await api.walletOpenBlockStar(url);
          if (!r.installed) setBlockstarMissing(true);
          return;
        }
        if (platform === 'ios-on-mac') {
          const r = await PlatformInfo.openExternal({ url: blockstarBrowserUrl(url) });
          if (!r.opened) setBlockstarMissing(true);
          return;
        }
        // Older desktop build without the BlockStar IPC: ask the OS directly.
        if (api) {
          const r = await api.walletOpenBrowser(blockstarBrowserUrl(url));
          if (!r.success) setBlockstarMissing(true);
        }
        return;
      }

      // target === 'browser'
      if (api) {
        await api.walletOpenBrowser(url);
      } else if (platform === 'ios-on-mac') {
        await PlatformInfo.openExternal({ url });
      }
    },
    [platform]
  );

  // ─── Start an operation (shared by connect + sign) ───
  const begin = useCallback(
    (kind: PendingKind, id: string, message?: string) =>
      new Promise<string>((resolve, reject) => {
        // Cancel anything already in flight
        if (pendingRef.current) {
          clearTimeout(pendingRef.current.timer);
          pendingRef.current.reject(new Error('Superseded by a new request'));
        }
        const timer = setTimeout(() => {
          setError('Timed out waiting for the browser');
          settle(false, new Error('Timed out'));
        }, TIMEOUT_MS);
        pendingRef.current = { kind, id, message, resolve, reject, timer };
      }),
    [settle]
  );

  // ═══════════════════════════════════════════════════════════════
  // CONNECT
  // ═══════════════════════════════════════════════════════════════

  const connect = useCallback(
    async (target: DesktopWalletTarget = 'browser'): Promise<string> => {
      setError(null);
      setIsConnecting(true);
      const id = newId();
      const done = begin('connect', id);
      try {
        const cb = await getCallbacks();
        const url = new URL(AUTH_PAGE_URL);
        url.searchParams.set('session', id);
        url.searchParams.set('callback', cb.connect);
        url.searchParams.set('cancelUrl', cb.cancel);
        url.searchParams.set('chainId', String(DEFAULT_CHAIN_ID));
        if (target === 'blockstar') url.searchParams.set('wallet', 'blockstar');
        const href = url.toString();

        savedRef.current = { ...(savedRef.current || { address: '' }), target };
        setPendingUrl(href);
        await openInTarget(href, target);
      } catch (e: any) {
        console.log(e);
        setError(e?.message || 'Could not start wallet connection');
        await settle(false, e instanceof Error ? e : new Error(String(e)));
      }
      return done;
    },
    [begin, getCallbacks, openInTarget, settle]
  );

  /** Backward-compatible alias (old code called desktopWallet.open()). */
  const open = useCallback(() => connect('browser').catch(() => {}), [connect]);

  // ═══════════════════════════════════════════════════════════════
  // SIGN
  // ═══════════════════════════════════════════════════════════════

  const signMessageAsync = useCallback(
    async ({ message }: { message: string }): Promise<string> => {
      const addr = addressRef.current;
      if (!addr) throw new Error('Wallet not connected');

      setError(null);
      setIsSigning(true);
      const id = newId();
      const done = begin('sign', id, message);
      try {
        const cb = await getCallbacks();
        const url = new URL(SIGN_PAGE_URL);
        url.searchParams.set('signId', id);
        url.searchParams.set('address', addr);
        url.searchParams.set('message', message);
        url.searchParams.set('enc', '1'); // message is single-encoded (old builds double-encoded)
        url.searchParams.set('callback', cb.sign);
        url.searchParams.set('cancelUrl', cb.cancel);
        const saved = savedRef.current;
        if (saved?.rdns) url.searchParams.set('rdns', saved.rdns);
        const target = saved?.target || 'browser';
        if (target === 'blockstar') url.searchParams.set('wallet', 'blockstar');
        const href = url.toString();

        setPendingUrl(href);
        await openInTarget(href, target);
      } catch (e: any) {
        setError(e?.message || 'Could not start signing');
        await settle(false, e instanceof Error ? e : new Error(String(e)));
      }
      return done;
    },
    [begin, getCallbacks, openInTarget, settle]
  );

  // ═══════════════════════════════════════════════════════════════
  // CONTROLS
  // ═══════════════════════════════════════════════════════════════

  /** Copy the current connect/sign link; remembers that the user opens links manually. */
  const copyLink = useCallback(async (): Promise<boolean> => {
    if (!pendingUrl) return false;
    const ok = await copyText(pendingUrl);
    if (ok) {
      savedRef.current = { ...(savedRef.current || { address: '' }), target: 'link' };
    }
    return ok;
  }, [pendingUrl]);

  /** Re-open the current link in a specific target (e.g. after installing BlockStar Browser). */
  const reopen = useCallback(
    async (target: DesktopWalletTarget) => {
      if (!pendingUrl) return;
      savedRef.current = { ...(savedRef.current || { address: '' }), target };
      await openInTarget(pendingUrl, target);
    },
    [pendingUrl, openInTarget]
  );

  const cancel = useCallback(() => {
    settle(false, new Error('User cancelled'));
  }, [settle]);

  const disconnect = useCallback(() => {
    if (pendingRef.current) settle(false, new Error('Disconnected'));
    savedRef.current = null;
    setAddress(undefined);
    setIsConnected(false);
    setError(null);
    localStorage.removeItem(STORAGE_KEY);
  }, [settle]);

  return {
    // State
    platform,
    isDesktop,
    address,
    isConnected,
    isConnecting,
    isSigning,
    pendingUrl,
    error,
    blockstarMissing,
    // Actions
    connect,
    open,
    signMessageAsync,
    copyLink,
    reopen,
    cancel,
    disconnect,
  };
}

export type DesktopWallet = ReturnType<typeof useDesktopWallet>;
