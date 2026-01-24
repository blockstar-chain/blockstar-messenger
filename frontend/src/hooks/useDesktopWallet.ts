'use client';

/**
 * useDesktopWallet - Hook for desktop wallet connection
 * 
 * FIXED FOR WINDOWS: Uses file:// protocol as primary detection
 * since Electron loads from file:// on all platforms.
 * 
 * Place in: frontend/hooks/useDesktopWallet.ts
 */

import { useState, useCallback, useEffect, useRef } from 'react';

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const AUTH_PAGE_URL = process.env.NEXT_PUBLIC_WALLET_AUTH_URL || 'https://blockstar.world/wallet-auth.html';
const SIGN_PAGE_URL = process.env.NEXT_PUBLIC_WALLET_SIGN_URL || 'https://blockstar.world/wallet-sign.html';
const DEFAULT_CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '137', 16) || 137;

// ═══════════════════════════════════════════════════════════════
// ELECTRON DETECTION
// ═══════════════════════════════════════════════════════════════

interface ElectronAPI {
  isElectron?: boolean;
  walletOpenBrowser?: (url: string) => Promise<{ success: boolean }>;
  walletStartServer?: () => Promise<{ port: number | null; error?: string }>;
  walletStopServer?: () => Promise<{ success: boolean }>;
  onWalletConnected?: (callback: (data: any) => void) => () => void;
  onWalletCancelled?: (callback: () => void) => () => void;
  onWalletSigned?: (callback: (data: any) => void) => () => void;
}

function getElectronAPI(): ElectronAPI | null {
  if (typeof window === 'undefined') return null;
  return (window as any).electronAPI || null;
}

/**
 * Check if running in Electron desktop app
 * PRIMARY METHOD: Check for file:// protocol (Electron loads from file://)
 */
export function isDesktopApp(): boolean {
  if (typeof window === 'undefined') return false;
  
  // PRIMARY: file:// protocol is definitive proof of Electron
  const isFileProtocol = window.location.protocol === 'file:';
  
  // SECONDARY: Check electronAPI
  const hasElectronAPI = !!(window as any).electronAPI?.isElectron;
  
  // TERTIARY: Check userAgent
  const hasElectronUA = navigator.userAgent.toLowerCase().includes('electron');
  
  const result = isFileProtocol || hasElectronAPI || hasElectronUA;
  
  // Log once on first check
  if (typeof (window as any).__desktopCheckLogged === 'undefined') {
    (window as any).__desktopCheckLogged = true;
    console.log('[DesktopWallet] Platform detection:', {
      isFileProtocol,
      hasElectronAPI,
      hasElectronUA,
      result,
      protocol: window.location.protocol,
    });
  }
  
  return result;
}

/**
 * Check if wallet bridge APIs are available
 */
export function isWalletBridgeReady(): boolean {
  const api = getElectronAPI();
  return !!(api && typeof api.walletOpenBrowser === 'function');
}

// Storage key
const STORAGE_KEY = 'desktop_wallet';

// ═══════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════

export function useDesktopWallet() {
  const [address, setAddress] = useState<string | undefined>(undefined);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const cleanupRef = useRef<(() => void) | null>(null);
  const signResolveRef = useRef<((sig: string) => void) | null>(null);
  const signRejectRef = useRef<((err: Error) => void) | null>(null);
  
  // Detect platform on mount - with retry for bridge
  useEffect(() => {
    const checkPlatform = () => {
      const desktop = isDesktopApp();
      const bridge = isWalletBridgeReady();
      
      setIsDesktop(desktop);
      setBridgeReady(bridge);
      
      console.log('[DesktopWallet] Check:', { desktop, bridge });
      
      // If desktop but bridge not ready, retry a few times
      if (desktop && !bridge) {
        return false; // Not ready yet
      }
      return true; // Ready or not desktop
    };
    
    // Initial check
    if (!checkPlatform()) {
      // Retry with delays - preload might not be ready yet
      const retries = [100, 500, 1000, 2000];
      retries.forEach((delay, i) => {
        setTimeout(() => {
          if (!isWalletBridgeReady() && isDesktopApp()) {
            console.log(`[DesktopWallet] Retry ${i + 1}: checking bridge...`);
            const ready = isWalletBridgeReady();
            setBridgeReady(ready);
            if (!ready && i === retries.length - 1) {
              console.error('[DesktopWallet] ⚠️ Bridge not available after retries');
              console.error('[DesktopWallet] window.electronAPI:', (window as any).electronAPI);
              setError('Wallet bridge not available. Please restart the app.');
            }
          }
        }, delay);
      });
    }
    
    // Restore saved connection if desktop
    if (isDesktopApp()) {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved);
          if (data.address) {
            setAddress(data.address);
            setIsConnected(true);
            console.log('[DesktopWallet] Restored:', data.address);
          }
        }
      } catch (e) {
        console.error('[DesktopWallet] Restore error:', e);
      }
    }
  }, []);
  
  // ─────────────────────────────────────────────────────────────
  // OPEN (connect)
  // ─────────────────────────────────────────────────────────────
  
  const open = useCallback(async () => {
    const electronAPI = getElectronAPI();
    
    console.log('[DesktopWallet] open() called', { 
      hasAPI: !!electronAPI,
      hasWalletOpen: typeof electronAPI?.walletOpenBrowser === 'function',
      isConnected,
      address 
    });
    
    // Check if bridge is available
    if (!electronAPI?.walletOpenBrowser) {
      const msg = 'Wallet bridge not available. Try restarting the app.';
      console.error('[DesktopWallet]', msg);
      setError(msg);
      return;
    }
    
    // If already connected, disconnect
    if (isConnected && address) {
      console.log('[DesktopWallet] Disconnecting...');
      setAddress(undefined);
      setIsConnected(false);
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    
    setIsConnecting(true);
    setError(null);
    
    try {
      const session = crypto.randomUUID();
      
      // Start callback server
      console.log('[DesktopWallet] Starting server...');
      const serverResult = await electronAPI.walletStartServer!();
      
      if (!serverResult.port) {
        throw new Error(serverResult.error || 'Failed to start callback server');
      }
      
      console.log('[DesktopWallet] Server on port:', serverResult.port);
      
      // Set up event listeners
      const cleanupConnected = electronAPI.onWalletConnected?.((data) => {
        if (data.session !== session) return;
        
        console.log('[DesktopWallet] ✅ Connected:', data.address);
        
        setAddress(data.address);
        setIsConnected(true);
        setIsConnecting(false);
        
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          address: data.address,
          chainId: data.chainId,
        }));
        
        cleanupRef.current?.();
        electronAPI.walletStopServer?.();
      }) || (() => {});
      
      const cleanupCancelled = electronAPI.onWalletCancelled?.(() => {
        console.log('[DesktopWallet] ❌ Cancelled');
        setIsConnecting(false);
        cleanupRef.current?.();
        electronAPI.walletStopServer?.();
      }) || (() => {});
      
      cleanupRef.current = () => {
        cleanupConnected();
        cleanupCancelled();
      };
      
      // Build auth URL
      const url = new URL(AUTH_PAGE_URL);
      url.searchParams.set('session', session);
      url.searchParams.set('callback', `http://127.0.0.1:${serverResult.port}/callback`);
      url.searchParams.set('cancelUrl', `http://127.0.0.1:${serverResult.port}/cancel`);
      url.searchParams.set('chainId', DEFAULT_CHAIN_ID.toString());
      
      console.log('[DesktopWallet] Opening browser...');
      await electronAPI.walletOpenBrowser(url.toString());
      
      // Timeout
      setTimeout(() => {
        if (isConnecting) {
          console.log('[DesktopWallet] Timeout');
          setIsConnecting(false);
          setError('Connection timed out');
          cleanupRef.current?.();
          electronAPI.walletStopServer?.();
        }
      }, 5 * 60 * 1000);
      
    } catch (err: any) {
      console.error('[DesktopWallet] Error:', err);
      setIsConnecting(false);
      setError(err.message || 'Connection failed');
    }
  }, [isConnected, address, isConnecting]);
  
  // ─────────────────────────────────────────────────────────────
  // SIGN MESSAGE
  // ─────────────────────────────────────────────────────────────
  
  const signMessageAsync = useCallback(async ({ message }: { message: string }): Promise<string> => {
    const electronAPI = getElectronAPI();
    
    if (!electronAPI?.walletOpenBrowser) {
      throw new Error('Wallet bridge not available');
    }
    
    if (!address) {
      throw new Error('Wallet not connected');
    }
    
    setIsSigning(true);
    console.log('[DesktopWallet] Signing message...');
    
    return new Promise(async (resolve, reject) => {
      signResolveRef.current = resolve;
      signRejectRef.current = reject;
      
      try {
        const signId = crypto.randomUUID();
        
        const serverResult = await electronAPI.walletStartServer!();
        if (!serverResult.port) {
          throw new Error(serverResult.error || 'Server failed');
        }
        
        const cleanupSigned = electronAPI.onWalletSigned?.((data) => {
          if (data.signId !== signId) return;
          
          console.log('[DesktopWallet] ✅ Signed');
          setIsSigning(false);
          cleanupRef.current?.();
          electronAPI.walletStopServer?.();
          
          if (data.signature) {
            signResolveRef.current?.(data.signature);
          } else {
            signRejectRef.current?.(new Error(data.error || 'Sign failed'));
          }
        }) || (() => {});
        
        const cleanupCancelled = electronAPI.onWalletCancelled?.(() => {
          console.log('[DesktopWallet] ❌ Sign cancelled');
          setIsSigning(false);
          cleanupRef.current?.();
          electronAPI.walletStopServer?.();
          signRejectRef.current?.(new Error('Cancelled'));
        }) || (() => {});
        
        cleanupRef.current = () => {
          cleanupSigned();
          cleanupCancelled();
        };
        
        const url = new URL(SIGN_PAGE_URL);
        url.searchParams.set('signId', signId);
        url.searchParams.set('address', address);
        url.searchParams.set('message', encodeURIComponent(message));
        url.searchParams.set('callback', `http://127.0.0.1:${serverResult.port}/sign-callback`);
        url.searchParams.set('cancelUrl', `http://127.0.0.1:${serverResult.port}/cancel`);
        
        await electronAPI.walletOpenBrowser(url.toString());
        
        setTimeout(() => {
          if (isSigning) {
            setIsSigning(false);
            cleanupRef.current?.();
            electronAPI.walletStopServer?.();
            signRejectRef.current?.(new Error('Sign timeout'));
          }
        }, 5 * 60 * 1000);
        
      } catch (err) {
        setIsSigning(false);
        reject(err);
      }
    });
  }, [address, isSigning]);
  
  // ─────────────────────────────────────────────────────────────
  // DISCONNECT
  // ─────────────────────────────────────────────────────────────
  
  const disconnect = useCallback(() => {
    setAddress(undefined);
    setIsConnected(false);
    localStorage.removeItem(STORAGE_KEY);
  }, []);
  
  return {
    address,
    isConnected,
    open,
    signMessageAsync,
    isConnecting,
    isSigning,
    disconnect,
    isDesktop,
    bridgeReady,
    error,
  };
}
