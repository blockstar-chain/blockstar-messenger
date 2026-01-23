'use client';

/**
 * Updated ConnectButton
 * 
 * - On Desktop (Electron): Uses browser-based MetaMask flow
 * - On Mobile/Web: Uses existing Reown/AppKit modal
 * 
 * Replace your existing ConnectButton.tsx with this
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
  
  // Desktop wallet hook
  const desktopWallet = useDesktopWallet();
  
  // Reown/AppKit hooks (for mobile/web)
  const { open: openAppKit } = useAppKit();
  const { address: appKitAddress, isConnected: appKitConnected } = useAppKitAccount();
  
  // Detect platform on mount
  useEffect(() => {
    setIsDesktop(isDesktopApp());
  }, []);
  
  // Use appropriate values based on platform
  const address = isDesktop ? desktopWallet.address : appKitAddress;
  const isConnected = isDesktop ? desktopWallet.isConnected : appKitConnected;
  const isConnecting = externalConnecting || (isDesktop && desktopWallet.isConnecting);
  
  const handleClick = () => {
    if (isDesktop) {
      desktopWallet.open();
    } else {
      openAppKit();
    }
  };

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
          </>
        )}
      </button>
    )
  );
}
