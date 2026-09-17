'use client';

/**
 * ConnectButton - Auto-switches between desktop and mobile/web
 *
 * Desktop (Capacitor Electron build): uses `desktopWallet` (your custom
 * WalletConnect/QR-based flow) because deep-link callbacks from a mobile
 * wallet app back into an Electron window aren't reliable.
 *
 * Mobile (iOS/Android via Capacitor) & Web: uses ConnectKit, which handles
 * deep links / in-app browser redirects correctly on those platforms.
 */

import { trimAddress } from "@/utils/helpers";
import { Wallet } from "lucide-react";
import { ConnectKitButton } from "connectkit";

interface ConnectButtonProps {
  className?: string;
  isDesktop?: boolean;
  desktopWallet: {
    open: () => void;
  };
  address?: string;
  isConnected?: boolean;
  isConnecting?: boolean;
}

export default function ConnectButton({
  className,
  isDesktop,
  desktopWallet,
  address,
  isConnected,
  isConnecting,
}: ConnectButtonProps) {
  // --- Desktop branch: fully separate login path ---
  if (isDesktop) {
    return (
      <button
        className={className}
        onClick={() => desktopWallet.open()}
        disabled={isConnecting}
      >
        {isConnected ? (
          <>{trimAddress(address)}</>
        ) : (
          <>
            <Wallet size={22} />
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </>
        )}
      </button>
    );
  }

  // --- Mobile / Web branch: ConnectKit handles its own state ---
  return (
    <ConnectKitButton.Custom>
      {({ isConnected: ckConnected, isConnecting: ckConnecting, show, address: ckAddress }) => (
        <button className={className} onClick={show} disabled={ckConnecting}>
          {ckConnected ? (
            <>{trimAddress(ckAddress)}</>
          ) : (
            <>
              <Wallet size={22} />
              Connect Wallet
            </>
          )}
        </button>
      )}
    </ConnectKitButton.Custom>
  );
}
