// frontend/src/components/MeshNetworkModal.tsx
// Full-screen modal for mesh networking features
// Shows MeshNetworkTab with all features: overview, peers, QR connect, messages
//
// FIX: publicKey is often passed as `encryptionService.getPublicKey()` — a NEW
// Promise on every parent render. Previously this modal depended on `publicKey`
// in its resolve effect, so every parent re-render re-ran it, flipped isLoading,
// and unmounted/remounted MeshNetworkTab — wiping its tab/QR/settings state
// ("flash then revert to Overview"). We now resolve the key ONCE per open and
// ignore later prop-identity churn while the modal stays open.

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Radio, Loader2 } from 'lucide-react';
import MeshNetworkTab from './MeshNetworkTab';
import { meshNetworkService } from '@/lib/mesh/MeshNetworkService';

interface MeshNetworkModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: string;
  // Accept string, Uint8Array, or Promise<string> for flexibility
  publicKey: string | Uint8Array | Promise<string>;
  username?: string;
  avatar?: string;
}

export default function MeshNetworkModal({
  isOpen,
  onClose,
  walletAddress,
  publicKey,
  username,
  avatar,
}: MeshNetworkModalProps) {
  const [resolvedPublicKey, setResolvedPublicKey] = useState<string | Uint8Array | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Keep the latest publicKey in a ref so the resolve effect can read it without
  // depending on it (its identity changes every parent render when it's a Promise).
  const publicKeyRef = useRef(publicKey);
  publicKeyRef.current = publicKey;

  // Guard so we resolve only once per "open" session.
  const resolvedForOpen = useRef(false);

  useEffect(() => {
    // Modal closed: reset for the next open.
    if (!isOpen) {
      resolvedForOpen.current = false;
      setResolvedPublicKey(null);
      setIsLoading(false);
      return;
    }

    // Already resolved for this open session — don't thrash on re-renders.
    if (resolvedForOpen.current) return;
    resolvedForOpen.current = true;

    let cancelled = false;
    const key = publicKeyRef.current;

    const resolveKey = async () => {
      if (!key) {
        setResolvedPublicKey(null);
        return;
      }
      if (key instanceof Promise) {
        setIsLoading(true);
        try {
          const resolved = await key;
          if (!cancelled) setResolvedPublicKey(resolved);
        } catch (e) {
          console.error('Failed to resolve publicKey:', e);
          if (!cancelled) {
            setResolvedPublicKey(null);
            // Allow a retry on the next open if this attempt failed.
            resolvedForOpen.current = false;
          }
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      } else {
        // Already a string or Uint8Array
        setResolvedPublicKey(key);
      }
    };

    resolveKey();
    return () => {
      cancelled = true;
    };
    // Intentionally depends ONLY on isOpen — publicKey is read via ref so a new
    // Promise identity from the parent can't remount the tab mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Initialize mesh service when modal opens and key is resolved
  useEffect(() => {
    if (isOpen && walletAddress && resolvedPublicKey) {
      meshNetworkService.initialize(walletAddress, resolvedPublicKey, username, avatar);
    }
  }, [isOpen, walletAddress, resolvedPublicKey, username, avatar]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end md:items-center justify-center">
      <div className="bg-midnight-light border-t md:border border-midnight rounded-t-2xl md:rounded-2xl w-full md:max-w-2xl max-h-[95vh] md:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-midnight flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
              <Radio className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Mesh Network</h3>
              <p className="text-xs text-gray-400">Offline peer-to-peer communication</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-midnight rounded-lg transition"
          >
            <X size={20} className="text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
            </div>
          ) : resolvedPublicKey ? (
            <MeshNetworkTab
              walletAddress={walletAddress}
              publicKey={resolvedPublicKey}
              username={username}
              avatar={avatar}
            />
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <Radio className="w-12 h-12 text-gray-600 mb-4" />
              <p className="text-gray-400">Unable to initialize mesh networking</p>
              <p className="text-sm text-gray-500 mt-2">Please ensure you're logged in</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
