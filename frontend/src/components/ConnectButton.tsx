'use client';

/**
 * ConnectButton
 *
 * Desktop (Electron, or the iOS app on a Mac): opens DesktopConnectModal with
 *   BlockStar Wallet / Browser wallet / Mobile wallet (QR).
 * Mobile + Web: ConnectKit modal (unchanged).
 *
 * While platform detection is still running, the button is shown disabled so the
 * wrong modal can never flash open.
 */

import React, { useState } from 'react';
import { trimAddress } from '@/utils/helpers';
import { Wallet } from 'lucide-react';
import { ConnectKitButton, useModal } from 'connectkit';
import DesktopConnectModal from './DesktopConnectModal';
import type { DesktopWallet } from '@/hooks/useDesktopWallet';

interface ConnectButtonProps {
  className?: string;
  /** null while platform detection is still running */
  isDesktop: boolean | null;
  desktopWallet: DesktopWallet;
  /** Address currently driving auth (desktop wallet or wagmi) */
  address?: string;
  isConnecting?: boolean;
}

export default function ConnectButton({
  className,
  isDesktop,
  desktopWallet,
  address,
  isConnecting,
}: ConnectButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const { setOpen: setConnectKitOpen } = useModal();

  // Detection not finished yet
  if (isDesktop === null) {
    return (
      <button className={className} disabled>
        <Wallet size={22} />
        Loading…
      </button>
    );
  }

  // ─── Desktop ───
  if (isDesktop) {
    const busy = isConnecting || desktopWallet.isConnecting || desktopWallet.isSigning;
    return (
      <>
        <button className={className} onClick={() => setModalOpen(true)} disabled={busy}>
          {address ? (
            <>{trimAddress(address)}</>
          ) : (
            <>
              <Wallet size={22} />
              {desktopWallet.isConnecting ? 'Connecting…' : 'Connect Wallet'}
            </>
          )}
        </button>
        <DesktopConnectModal
          wallet={desktopWallet}
          isOpen={modalOpen || desktopWallet.isConnecting}
          onClose={() => setModalOpen(false)}
          onUseQr={() => setConnectKitOpen(true)}
        />
      </>
    );
  }

  // ─── Mobile / Web: ConnectKit ───
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
