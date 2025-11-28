// frontend/src/components/ContactAvatar.tsx
// BlockStar Cypher - Contact Avatar Component
// Displays user avatar from BlockStar Domains profile or fallback

'use client';

import React, { useState, useEffect } from 'react';
import { getCachedProfile, resolveProfile, type BlockStarProfile } from '@/lib/profileResolver';

interface ContactAvatarProps {
  username?: string;
  walletAddress: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showOnlineIndicator?: boolean;
  isOnline?: boolean;
  onClick?: () => void;
  className?: string;
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg',
};

const indicatorSizes = {
  sm: 'w-2.5 h-2.5 -bottom-0.5 -right-0.5',
  md: 'w-3 h-3 -bottom-0.5 -right-0.5',
  lg: 'w-3.5 h-3.5 bottom-0 right-0',
  xl: 'w-4 h-4 bottom-0.5 right-0.5',
};

export default function ContactAvatar({
  username,
  walletAddress,
  size = 'md',
  showOnlineIndicator = false,
  isOnline = false,
  onClick,
  className = '',
}: ContactAvatarProps) {
  const [profile, setProfile] = useState<BlockStarProfile | null>(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (username) {
      // Check cache first
      const cached = getCachedProfile(username);
      if (cached) {
        setProfile(cached);
        setImageError(false);
      } else {
        // Fetch profile
        resolveProfile(username).then((data) => {
          if (data) {
            setProfile(data);
            setImageError(false);
          }
        });
      }
    }
  }, [username]);

  // Get display values
  const avatarUrl = profile?.avatar;
  const displayName = profile?.username || username || walletAddress;
  const initials = getInitials(displayName);
  const bgColor = getAvatarColor(walletAddress);

  const handleImageError = () => {
    setImageError(true);
  };

  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={`relative inline-flex items-center justify-center rounded-full overflow-hidden ${sizeClasses[size]} ${bgColor} ${
        onClick ? 'cursor-pointer hover:ring-2 hover:ring-primary-500 transition-all' : ''
      } ${className}`}
    >
      {avatarUrl && !imageError ? (
        <img
          src={avatarUrl}
          alt={displayName}
          className="w-full h-full object-cover"
          onError={handleImageError}
        />
      ) : (
        <span className="font-semibold text-white">
          {initials}
        </span>
      )}

      {/* Online indicator */}
      {showOnlineIndicator && (
        <span
          className={`absolute ${indicatorSizes[size]} rounded-full border-2 border-midnight ${
            isOnline ? 'bg-success-500 shadow-glow-green' : 'bg-muted'
          }`}
        />
      )}
    </Component>
  );
}

// Helper functions
function getInitials(name: string): string {
  if (!name) return '?';
  
  // If it's a wallet address, use first 2 chars after 0x
  if (name.startsWith('0x')) {
    return name.slice(2, 4).toUpperCase();
  }
  
  // If it's an @username, get first char
  if (name.includes('@')) {
    return name.split('@')[0].charAt(0).toUpperCase();
  }
  
  // Otherwise get first char
  return name.charAt(0).toUpperCase();
}

function getAvatarColor(address: string): string {
  const colors = [
    'bg-gradient-to-br from-primary-500 to-cyan-500',
    'bg-gradient-to-br from-primary-600 to-primary-400',
    'bg-gradient-to-br from-cyan-500 to-primary-500',
    'bg-gradient-to-br from-success-500 to-cyan-500',
    'bg-gradient-to-br from-primary-500 to-success-500',
    'bg-gradient-to-br from-cyan-600 to-cyan-400',
    'bg-gradient-to-br from-primary-400 to-cyan-600',
    'bg-gradient-to-br from-cyan-400 to-primary-600',
  ];
  
  // Generate a consistent color based on the address
  const hash = address.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  
  return colors[Math.abs(hash) % colors.length];
}

// Export helper functions for use elsewhere
export { getInitials, getAvatarColor };
