// frontend/src/components/ProfileModal.tsx
// BlockStar Cypher - Profile Modal Component
// Shows detailed user profile in a modal overlay

'use client';

import React from 'react';
import ProfileCard from './ProfileCard';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  username?: string;
  walletAddress: string;
  isOnline?: boolean;
  onMessage?: () => void;
  onCall?: () => void;
  onVideoCall?: () => void;
}

export default function ProfileModal({
  isOpen,
  onClose,
  username,
  walletAddress,
  isOnline,
  onMessage,
  onCall,
  onVideoCall,
}: ProfileModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal content */}
      <div className="relative z-10 w-full max-w-md mx-4 animate-in fade-in zoom-in duration-200">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-20 w-8 h-8 flex items-center justify-center bg-card hover:bg-dark-100 border border-midnight rounded-full text-secondary hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        
        {/* Profile card */}
        <ProfileCard
          username={username}
          walletAddress={walletAddress}
          isOnline={isOnline}
          showActions={true}
          onMessage={() => {
            onMessage?.();
            onClose();
          }}
          onCall={() => {
            onCall?.();
            onClose();
          }}
          onVideoCall={() => {
            onVideoCall?.();
            onClose();
          }}
        />
      </div>
    </div>
  );
}
