'use client';

/**
 * useBrowserWallet - Hook for MetaMask browser connection in Electron
 * 
 * Place this file in: frontend/hooks/useBrowserWallet.ts
 * 
 * Usage:
 *   const { connectBrowser, isConnecting, isElectron } = useBrowserWallet({
 *     authPageUrl: 'https://your-domain.com/wallet-auth.html',
 *     onSuccess: (address, chainId) => { ... },
 *   });
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// Type for the Electron API (matches your existing preload.js structure)
interface ElectronAPI {
  // Existing APIs
  getPlatform: () => Promise<{ platform: string; arch: string; version: string }>;
  getAppVersion: () => Promise<string>;
  showNotification: (title: string, body: string) => Promise<boolean>;
  minimizeToTray: () => void;
  onDeepLink: (callback: (url: string) => void) => void;
  isElectron: boolean;
  
  // Wallet Bridge APIs (new)
  walletOpenBrowser: (url: string) => Promise<{ success: boolean }>;
  walletStartServer: () => Promise<{ port: number | null; error?: string }>;
  walletStopServer: () => Promise<{ success: boolean }>;
  onWalletConnected: (callback: (data: WalletCallbackData) => void) => () => void;
  onWalletCancelled: (callback: () => void) => () => void;
}

interface WalletCallbackData {
  address: string;
  chainId: string;
  session: string;
}

interface UseBrowserWalletOptions {
  /** URL of your hosted wallet-auth.html page */
  authPageUrl: string;
  /** Chain ID to request (optional) */
  chainId?: number;
  /** Called when wallet connects successfully */
  onSuccess?: (address: string, chainId: number) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Called when user cancels */
  onCancel?: () => void;
}

interface UseBrowserWalletReturn {
  /** Initiate browser wallet connection */
  connectBrowser: () => Promise<void>;
  /** Cancel pending connection */
  cancel: () => void;
  /** Current connection status */
  isConnecting: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether running in Electron desktop app */
  isElectron: boolean;
}

// Get the Electron API from window
function getElectronAPI(): ElectronAPI | null {
  if (typeof window !== 'undefined' && (window as any).electronAPI?.isElectron) {
    return (window as any).electronAPI as ElectronAPI;
  }
  return null;
}

/**
 * Check if running in Electron (can be used outside of hook)
 */
export function isElectronApp(): boolean {
  return !!getElectronAPI()?.isElectron;
}

/**
 * Hook for browser-based wallet connection in Electron desktop app
 */
export function useBrowserWallet(options: UseBrowserWalletOptions): UseBrowserWalletReturn {
  const { authPageUrl, chainId, onSuccess, onError, onCancel } = options;

  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isElectron, setIsElectron] = useState(false);

  const sessionRef = useRef<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Check if running in Electron on mount
  useEffect(() => {
    setIsElectron(isElectronApp());
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const cancel = useCallback(() => {
    const electronAPI = getElectronAPI();
    
    cleanupRef.current?.();
    cleanupRef.current = null;
    sessionRef.current = null;
    setIsConnecting(false);
    
    // Stop the callback server
    electronAPI?.walletStopServer();
  }, []);

  const connectBrowser = useCallback(async () => {
    const electronAPI = getElectronAPI();

    if (!electronAPI) {
      const err = new Error('Browser wallet connection only available in desktop app');
      setError(err.message);
      onError?.(err);
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      // Generate session ID
      const session = crypto.randomUUID();
      sessionRef.current = session;

      // Start callback server
      const serverResult = await electronAPI.walletStartServer();
      if (!serverResult.port) {
        throw new Error(serverResult.error || 'Failed to start callback server');
      }

      // Set up event listeners
      const cleanupConnected = electronAPI.onWalletConnected((data) => {
        // Verify session matches
        if (data.session !== sessionRef.current) {
          console.warn('[BrowserWallet] Session mismatch, ignoring');
          return;
        }

        console.log('[BrowserWallet] Connected:', data.address);

        setIsConnecting(false);
        setError(null);
        sessionRef.current = null;

        onSuccess?.(data.address, parseInt(data.chainId));

        // Cleanup
        cleanupRef.current?.();
        cleanupRef.current = null;
        electronAPI.walletStopServer();
      });

      const cleanupCancelled = electronAPI.onWalletCancelled(() => {
        console.log('[BrowserWallet] User cancelled');

        setIsConnecting(false);
        sessionRef.current = null;

        onCancel?.();

        // Cleanup
        cleanupRef.current?.();
        cleanupRef.current = null;
        electronAPI.walletStopServer();
      });

      // Store cleanup function
      cleanupRef.current = () => {
        cleanupConnected();
        cleanupCancelled();
      };

      // Build auth URL with parameters
      const url = new URL(authPageUrl);
      url.searchParams.set('session', session);
      url.searchParams.set('callback', `http://127.0.0.1:${serverResult.port}/callback`);
      url.searchParams.set('cancelUrl', `http://127.0.0.1:${serverResult.port}/cancel`);
      if (chainId) {
        url.searchParams.set('chainId', chainId.toString());
      }

      // Open in system browser
      await electronAPI.walletOpenBrowser(url.toString());

      console.log('[BrowserWallet] Opened browser:', url.toString());

      // Set timeout (5 minutes)
      const timeoutId = setTimeout(() => {
        if (sessionRef.current === session) {
          setIsConnecting(false);
          setError('Connection timed out. Please try again.');
          sessionRef.current = null;
          cleanupRef.current?.();
          cleanupRef.current = null;
          electronAPI.walletStopServer();
          onError?.(new Error('Connection timed out'));
        }
      }, 5 * 60 * 1000);

      // Add timeout cleanup
      const originalCleanup = cleanupRef.current;
      cleanupRef.current = () => {
        clearTimeout(timeoutId);
        originalCleanup?.();
      };

    } catch (err) {
      console.error('[BrowserWallet] Error:', err);
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error.message);
      setIsConnecting(false);
      onError?.(error);
    }
  }, [authPageUrl, chainId, onSuccess, onError, onCancel]);

  return {
    connectBrowser,
    cancel,
    isConnecting,
    error,
    isElectron,
  };
}

export default useBrowserWallet;
