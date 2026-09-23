'use client';

/**
 * DesktopConnectModal — wallet options for desktop builds (Electron + iOS app on Mac).
 *
 *   1. BlockStar Wallet   -> opens BlockStar Browser (built-in wallet)
 *   2. Browser wallet     -> opens the default browser (MetaMask, Rabby, Coinbase, ...)
 *   3. Mobile wallet (QR) -> ConnectKit in-app (scan with a phone wallet)
 *
 * While waiting, shows the link with a Copy button so the user can open it in a
 * different browser/profile on the same computer.
 *
 * DesktopWaitingPanel is exported separately so AuthPage can show the same
 * copy-link UI during the signature step.
 */

import React, { useState } from 'react';
import { X, Star, Globe, Smartphone, Copy, Check, AlertTriangle, ExternalLink } from 'lucide-react';
import type { DesktopWallet } from '@/hooks/useDesktopWallet';

const BLOCKSTAR_BROWSER_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_BLOCKSTAR_BROWSER_URL || 'https://blockstar.site';

// ═══════════════════════════════════════════════════════════════
// Waiting panel (connect or sign)
// ═══════════════════════════════════════════════════════════════

export function DesktopWaitingPanel({
  wallet,
  mode,
}: {
  wallet: DesktopWallet;
  mode: 'connect' | 'sign';
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await wallet.copyLink();
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-500 border-t-transparent flex-shrink-0" />
        <p className="text-white text-sm">
          {mode === 'connect'
            ? 'Waiting for you to connect in your browser…'
            : 'Waiting for you to approve the signature in your browser…'}
        </p>
      </div>

      {wallet.blockstarMissing && (
        <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/30 space-y-2">
          <p className="text-sm text-yellow-300 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            BlockStar Browser doesn&apos;t appear to be installed on this computer.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={BLOCKSTAR_BROWSER_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white inline-flex items-center gap-1"
            >
              Get BlockStar Browser <ExternalLink size={12} />
            </a>
            <button
              onClick={() => wallet.reopen('browser')}
              className="text-xs px-3 py-1.5 rounded-lg bg-dark-200 border border-midnight text-secondary hover:text-white"
            >
              Use my default browser instead
            </button>
          </div>
        </div>
      )}

      {wallet.pendingUrl && (
        <div className="space-y-2">
          <p className="text-xs text-secondary">
            Didn&apos;t open, or your wallet is in a different browser? Copy this link and open it
            in that browser <span className="text-white">on this computer</span>:
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={wallet.pendingUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 bg-dark-200 border border-midnight rounded-lg px-3 py-2 text-xs text-secondary font-mono"
            />
            <button
              onClick={handleCopy}
              className="flex-shrink-0 px-3 py-2 rounded-lg bg-dark-200 border border-midnight hover:border-primary-500/50 text-white text-xs inline-flex items-center gap-1"
            >
              {copied ? <Check size={14} className="text-success-500" /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {wallet.error && <p className="text-sm text-red-400">{wallet.error}</p>}

      <button
        onClick={wallet.cancel}
        className="w-full text-sm text-secondary hover:text-white py-2"
      >
        Cancel
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Modal
// ═══════════════════════════════════════════════════════════════

interface Props {
  wallet: DesktopWallet;
  isOpen: boolean;
  onClose: () => void;
  onUseQr: () => void;
}

export default function DesktopConnectModal({ wallet, isOpen, onClose, onUseQr }: Props) {
  if (!isOpen) return null;

  const choose = (target: 'blockstar' | 'browser') => {
    wallet
      .connect(target)
      .then(() => onClose())
      .catch(() => {
        /* error is shown in the panel via wallet.error */
      });
  };

  const close = () => {
    if (wallet.isConnecting) wallet.cancel();
    onClose();
  };

  const Option = ({
    icon: Icon,
    title,
    subtitle,
    onClick,
    highlight,
  }: {
    icon: any;
    title: string;
    subtitle: string;
    onClick: () => void;
    highlight?: boolean;
  }) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all border ${
        highlight
          ? 'bg-primary-500/10 border-primary-500/40 hover:border-primary-500'
          : 'bg-dark-200 border-midnight hover:border-primary-500/50'
      }`}
    >
      <div
        className={`p-2.5 rounded-lg flex-shrink-0 ${
          highlight ? 'bg-gradient-to-br from-primary-500 to-cyan-500' : 'bg-midnight'
        }`}
      >
        <Icon size={20} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-white">{title}</p>
        <p className="text-xs text-secondary">{subtitle}</p>
      </div>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-full max-w-md bg-card border border-midnight rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-white">Connect a wallet</h3>
          <button onClick={close} className="p-1 text-secondary hover:text-white" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {wallet.isConnecting ? (
          <DesktopWaitingPanel wallet={wallet} mode="connect" />
        ) : (
          <div className="space-y-3">
            <Option
              icon={Star}
              title="BlockStar Wallet"
              subtitle="Use the wallet built into BlockStar Browser"
              onClick={() => choose('blockstar')}
              highlight
            />
            <Option
              icon={Globe}
              title="Browser wallet"
              subtitle="MetaMask, Rabby, Coinbase and other extensions"
              onClick={() => choose('browser')}
            />
            <Option
              icon={Smartphone}
              title="Mobile wallet (QR code)"
              subtitle="Scan with a wallet app on your phone"
              onClick={() => {
                onClose();
                onUseQr();
              }}
            />
            {wallet.error && <p className="text-sm text-red-400 pt-1">{wallet.error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
