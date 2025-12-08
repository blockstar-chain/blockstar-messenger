// frontend/src/components/MeshNetworkModal.tsx
// Full-screen modal for mesh networking features
// Shows MeshNetworkTab with all features: overview, peers, QR connect, messages

'use client';

import React, { useEffect, useState } from 'react';
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

  // Resolve publicKey if it's a Promise
  useEffect(() => {
    if (!isOpen) {
      setResolvedPublicKey(null);
      return;
    }

    const resolveKey = async () => {
      if (!publicKey) {
        setResolvedPublicKey(null);
        return;
      }

      // Check if it's a Promise
      if (publicKey instanceof Promise) {
        setIsLoading(true);
        try {
          const resolved = await publicKey;
          setResolvedPublicKey(resolved);
        } catch (e) {
          console.error('Failed to resolve publicKey:', e);
          setResolvedPublicKey(null);
        } finally {
          setIsLoading(false);
        }
      } else {
        // It's already a string or Uint8Array
        setResolvedPublicKey(publicKey);
      }
    };

    resolveKey();
  }, [isOpen, publicKey]);

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
