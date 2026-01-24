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
  isDesktop?:boolean,
  desktopWallet:any,
  address:any,
  isConnected:any,
  isConnecting:any
}

export default function ConnectButton({ 
  className, 
  isDesktop,
  desktopWallet,
  address,
  isConnected,
  isConnecting


}: ConnectButtonProps) {

  // Reown/AppKit hooks (for mobile/web)
  const { open: openAppKit } = useAppKit();


  const handleClick = () => {

    if (isDesktop) {
      console.log('📱 Calling desktopWallet.open()...');
      desktopWallet.open();
    } else {
      console.log('📱 Calling openAppKit()...');
      openAppKit();
    }
  };



  return (
    <>
      {address && isConnected ? (
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
              </span>
            </>
          )}
        </button>
      )}
    </>
  )

}
