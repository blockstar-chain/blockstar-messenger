'use client';

/**
 * useDesktopWallet - Minimal hook for desktop wallet connection
 * 
 * Provides the SAME interface as useAppKitAccount + useSignMessage
 * but routes through system browser on Electron.
 * 
 * Place in: frontend/hooks/useDesktopWallet.ts
 */

import { useState, useCallback, useEffect, useRef } from 'react';

// ═══════════════════════════════════════════════════════════════
// CONFIG - Update these URLs after hosting the HTML files
// ═══════════════════════════════════════════════════════════════

const AUTH_PAGE_URL = process.env.NEXT_PUBLIC_WALLET_AUTH_URL || 'https://messenger.blockstar.world/wallet-auth.html';
const SIGN_PAGE_URL = process.env.NEXT_PUBLIC_WALLET_SIGN_URL || 'https://messenger.blockstar.world/wallet-sign.html';
const DEFAULT_CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '137', 16) || 137;

// ═══════════════════════════════════════════════════════════════
// ELECTRON API CHECK
// ═══════════════════════════════════════════════════════════════

interface ElectronAPI {
  isElectron: boolean;
  walletOpenBrowser: (url: string) => Promise<{ success: boolean }>;
  walletStartServer: () => Promise<{ port: number | null; error?: string }>;
  walletStopServer: () => Promise<{ success: boolean }>;
  onWalletConnected: (callback: (data: any) => void) => () => void;
  onWalletCancelled: (callback: () => void) => () => void;
  onWalletSigned: (callback: (data: any) => void) => () => void;
}

function getElectronAPI(): ElectronAPI | null {
  if (typeof window !== 'undefined' && (window as any).electronAPI?.isElectron) {
    return (window as any).electronAPI as ElectronAPI;
  }
  return null;
}

/**
 * Check if running in Electron desktop app
 */
export function isDesktopApp(): boolean {
  return !!getElectronAPI()?.isElectron;
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
  
  const cleanupRef = useRef<(() => void) | null>(null);
  const signResolveRef = useRef<((sig: string) => void) | null>(null);
  const signRejectRef = useRef<((err: Error) => void) | null>(null);
  
  // Restore saved connection on mount
  useEffect(() => {
    if (isDesktopApp()) {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved);
          if (data.address) {
            setAddress(data.address);
            setIsConnected(true);
          }
        }
      } catch (e) {
        console.error('[DesktopWallet] Failed to restore:', e);
      }
    }
  }, []);
  
  // ─────────────────────────────────────────────────────────────
  // OPEN MODAL (connect)
  // ─────────────────────────────────────────────────────────────
  
  const open = useCallback(async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) return;
    
    // If already connected, just return (or you could show account modal)
    if (isConnected && address) {
      // For now, disconnect on second click (like AppKit)
      setAddress(undefined);
      setIsConnected(false);
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    
    setIsConnecting(true);
    
    try {
      const session = crypto.randomUUID();
      
      // Start callback server
      const serverResult = await electronAPI.walletStartServer();
      if (!serverResult.port) {
        throw new Error(serverResult.error || 'Failed to start server');
      }
      
      // Set up listeners
      const cleanupConnected = electronAPI.onWalletConnected((data) => {
        if (data.session !== session) return;
        
        console.log('[DesktopWallet] Connected:', data.address);
        
        setAddress(data.address);
        setIsConnected(true);
        setIsConnecting(false);
        
        // Save to localStorage
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          address: data.address,
          chainId: data.chainId,
        }));
        
        cleanupRef.current?.();
        electronAPI.walletStopServer();
      });
      
      const cleanupCancelled = electronAPI.onWalletCancelled(() => {
        console.log('[DesktopWallet] Cancelled');
        setIsConnecting(false);
        cleanupRef.current?.();
        electronAPI.walletStopServer();
      });
      
      cleanupRef.current = () => {
        cleanupConnected();
        cleanupCancelled();
      };
      
      // Build URL
      const url = new URL(AUTH_PAGE_URL);
      url.searchParams.set('session', session);
      url.searchParams.set('callback', `http://127.0.0.1:${serverResult.port}/callback`);
      url.searchParams.set('cancelUrl', `http://127.0.0.1:${serverResult.port}/cancel`);
      url.searchParams.set('chainId', DEFAULT_CHAIN_ID.toString());
      
      // Open browser
      await electronAPI.walletOpenBrowser(url.toString());
      
      // Timeout after 5 min
      setTimeout(() => {
        if (isConnecting) {
          setIsConnecting(false);
          cleanupRef.current?.();
          electronAPI.walletStopServer();
        }
      }, 5 * 60 * 1000);
      
    } catch (error) {
      console.error('[DesktopWallet] Connect error:', error);
      setIsConnecting(false);
    }
  }, [isConnected, address, isConnecting]);
  
  // ─────────────────────────────────────────────────────────────
  // SIGN MESSAGE
  // ─────────────────────────────────────────────────────────────
  
  const signMessageAsync = useCallback(async ({ message }: { message: string }): Promise<string> => {
    const electronAPI = getElectronAPI();
    
    if (!electronAPI) {
      throw new Error('Not running in desktop app');
    }
    
    if (!address) {
      throw new Error('Wallet not connected');
    }
    
    setIsSigning(true);
    
    return new Promise(async (resolve, reject) => {
      signResolveRef.current = resolve;
      signRejectRef.current = reject;
      
      try {
        const signId = crypto.randomUUID();
        
        // Start server
        const serverResult = await electronAPI.walletStartServer();
        if (!serverResult.port) {
          throw new Error(serverResult.error || 'Failed to start server');
        }
        
        // Set up listeners
        const cleanupSigned = electronAPI.onWalletSigned?.((data) => {
          if (data.signId !== signId) return;
          
          console.log('[DesktopWallet] Signed');
          setIsSigning(false);
          
          cleanupRef.current?.();
          electronAPI.walletStopServer();
          
          if (data.signature) {
            signResolveRef.current?.(data.signature);
          } else {
            signRejectRef.current?.(new Error(data.error || 'Signing failed'));
          }
        }) || (() => {});
        
        const cleanupCancelled = electronAPI.onWalletCancelled(() => {
          console.log('[DesktopWallet] Sign cancelled');
          setIsSigning(false);
          cleanupRef.current?.();
          electronAPI.walletStopServer();
          signRejectRef.current?.(new Error('User cancelled'));
        });
        
        cleanupRef.current = () => {
          cleanupSigned();
          cleanupCancelled();
        };
        
        // Build URL
        const url = new URL(SIGN_PAGE_URL);
        url.searchParams.set('signId', signId);
        url.searchParams.set('address', address);
        url.searchParams.set('message', encodeURIComponent(message));
        url.searchParams.set('callback', `http://127.0.0.1:${serverResult.port}/sign-callback`);
        url.searchParams.set('cancelUrl', `http://127.0.0.1:${serverResult.port}/cancel`);
        
        // Open browser
        await electronAPI.walletOpenBrowser(url.toString());
        
        // Timeout
        setTimeout(() => {
          if (isSigning) {
            setIsSigning(false);
            cleanupRef.current?.();
            electronAPI.walletStopServer();
            signRejectRef.current?.(new Error('Signing timed out'));
          }
        }, 5 * 60 * 1000);
        
      } catch (error) {
        setIsSigning(false);
        reject(error);
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
    // Same as useAppKitAccount
    address,
    isConnected,
    
    // Same as useAppKit
    open,
    
    // Same as useSignMessage
    signMessageAsync,
    
    // Extra
    isConnecting,
    isSigning,
    disconnect,
    isDesktop: isDesktopApp(),
  };
}
