'use client';

/**
 * ConnectButton - Auto-switches between desktop and mobile/web
 * 
 * CRITICAL: This file REPLACES your existing ConnectButton.tsx
 * 
 * Make sure to:
 * 1. Delete or rename your old ConnectButton.tsx
 * 2. Clear build cache: rm -rf .next/ (or on Windows: rmdir /s .next)
 * 3. Rebuild: npm run build
 */

import { trimAddress } from "@/utils/helpers";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { Wallet } from "lucide-react";
import { useDesktopWallet, isDesktopApp } from "@/hooks/useDesktopWallet";
import { useEffect, useState } from "react";

interface ConnectButtonProps {
  className?: string;
  isConnecting?: boolean;
}

export default function ConnectButton({ className, isConnecting: externalConnecting }: ConnectButtonProps) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [mounted, setMounted] = useState(false);
  
  // Desktop wallet hook
  const desktopWallet = useDesktopWallet();
  
  // Reown/AppKit hooks (for mobile/web)
  const { open: openAppKit } = useAppKit();
  const { address: appKitAddress, isConnected: appKitConnected } = useAppKitAccount();
  
  // Detect platform on mount
  useEffect(() => {
    setMounted(true);
    const desktop = isDesktopApp();
    setIsDesktop(desktop);
    
    // ═══════════════════════════════════════════════════════════
    // DIAGNOSTIC LOG - This MUST appear in console
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔌 ConnectButton MOUNTED');
    console.log('   Protocol:', typeof window !== 'undefined' ? window.location.protocol : 'N/A');
    console.log('   isDesktop:', desktop);
    console.log('   electronAPI exists:', typeof window !== 'undefined' && !!(window as any).electronAPI);
    console.log('   electronAPI.isElectron:', typeof window !== 'undefined' && (window as any).electronAPI?.isElectron);
    console.log('   walletOpenBrowser:', typeof window !== 'undefined' && typeof (window as any).electronAPI?.walletOpenBrowser);
    console.log('═══════════════════════════════════════════════════════');
  }, []);
  
  // Use appropriate values based on platform
  const address = isDesktop ? desktopWallet.address : appKitAddress;
  const isConnected = isDesktop ? desktopWallet.isConnected : appKitConnected;
  const isConnecting = externalConnecting || (isDesktop && desktopWallet.isConnecting);
  
  const handleClick = () => {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔘 Connect Button CLICKED');
    console.log('   isDesktop:', isDesktop);
    console.log('   Using:', isDesktop ? 'DESKTOP WALLET (browser flow)' : 'REOWN/APPKIT (modal)');
    console.log('═══════════════════════════════════════════════════════');
    
    if (isDesktop) {
      console.log('📱 Calling desktopWallet.open()...');
      desktopWallet.open();
    } else {
      console.log('📱 Calling openAppKit()...');
      openAppKit();
    }
  };

  // Don't render until mounted to avoid hydration mismatch
  if (!mounted) {
    return (
      <button type="button" className={className} disabled>
        <Wallet size={22} />
        Loading...
      </button>
    );
  }

  return (
    address && isConnected ? (
      <button onClick={handleClick} type="button" className={className}>
        {isConnecting ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
            Connecting...
          </>
        ) : (
          <>
            {trimAddress(address)}
          </>
        )}
      </button>
    ) : (
      <button onClick={handleClick} type="button" className={className}>
        {isConnecting ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
            {isDesktop ? 'Opening Browser...' : 'Connecting...'}
          </>
        ) : (
          <>
            <Wallet size={22} />
            Connect Wallet
            {/* Debug indicator - remove in production */}
            <span style={{ fontSize: '10px', marginLeft: '4px', opacity: 0.5 }}>
              {isDesktop ? '(D)' : '(M)'}
            </span>
          </>
        )}
      </button>
    )
  );
}
