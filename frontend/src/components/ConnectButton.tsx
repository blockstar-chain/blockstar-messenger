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
import { Wallet } from "lucide-react";
import { useDesktopWallet, isDesktopApp } from "@/hooks/useDesktopWallet";
import { useEffect, useState } from "react";
import { ConnectKitButton } from "connectkit";

interface ConnectButtonProps {
  className?: string;
  isDesktop?: boolean,
  desktopWallet: any,
  address: any,
  isConnected: any,
  isConnecting: any
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



  const handleClick = () => {

    if (isDesktop) {
      console.log('📱 Calling desktopWallet.open()...');
      desktopWallet.open();
    } else {
      console.log('📱 Calling openAppKit()...');

    }
  };



  return (
    <>

      <ConnectKitButton.Custom>
        {({ isConnected, isConnecting, show, hide, address, ensName, chain }) => {
          return (
            <button className={className} onClick={show} >
              {isConnected ? <>
                {trimAddress(address)}
              </> : <>
                <Wallet size={22} />
                Connect Wallet
                {/* Debug indicator - remove in production */}
                <span style={{ fontSize: '10px', marginLeft: '4px', opacity: 0.5 }}>
                </span>
              </>}
            </button>
          );
        }}
      </ConnectKitButton.Custom>
    </>
  )

}
