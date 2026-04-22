// frontend/src/components/ProfileCard.tsx
// BlockStar Cypher - User Profile Card Component
// Displays NFT domain profile data from BlockStar Domains smart contract

'use client';

import React, { useEffect, useState } from 'react';
import {
  resolveProfile,
  getResolverUrl,
  isBlockStarDomain,
  formatUsername,
  type BlockStarProfile
} from '@/lib/profileResolver';

interface ProfileCardProps {
  username?: string;
  walletAddress: string;
  isOnline?: boolean;
  compact?: boolean;
  showActions?: boolean;
  onMessage?: () => void;
  onCall?: () => void;
  onVideoCall?: () => void;
}

export default function ProfileCard({
  username,
  walletAddress,
  isOnline = false,
  compact = false,
  showActions = true,
  onMessage,
  onCall,
  onVideoCall,
}: ProfileCardProps) {
  const [profile, setProfile] = useState<BlockStarProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch profile data when username changes
  useEffect(() => {
    if (username) {
      setLoading(true);
      setError(null);

      // Extract just the domain name (remove @blockstar if present)
      // V3: Pass full username with TLD so backend can resolve with correct TLD
      const domainName = username.startsWith('@') ? username.slice(1) : username;

      resolveProfile(domainName)
        .then((data) => {
          setProfile(data);
          setLoading(false);
        })
        .catch((err) => {
          console.error('Error loading profile:', err);
          setError('Failed to load profile');
          setLoading(false);
        });
    }
  }, [username]);

  // Get display values
  const displayName = profile?.fullUsername || profile?.username || username || shortenAddress(walletAddress);
  const avatar = profile?.avatar;
  const banner = profile?.banner;
  const bio = profile?.bio;
  const records = profile?.records || {};
  const resolverUrl = username ? getResolverUrl(username) : null;

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-card transition-colors">
        {/* Avatar */}
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-cyan-500 flex items-center justify-center overflow-hidden">
            {avatar ? (
              <img src={avatar} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-white font-bold text-sm">
                {displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          {/* Online indicator */}
          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-midnight ${isOnline ? 'bg-success-500 shadow-glow-green' : 'bg-muted'
            }`} />
        </div>

        {/* Name & address */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-white truncate">
            {displayName}
          </div>
          <div className="text-xs text-secondary truncate">
            {shortenAddress(profile?.walletAddress || walletAddress)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl overflow-hidden border border-midnight">
      {/* Banner */}
      {banner && (
        <div className="h-32 w-full overflow-hidden">
          <img src={banner} alt="Banner" className="w-full h-full object-cover" />
        </div>
      )}

      <div className={`p-6 ${banner ? '-mt-12' : ''}`}>
        {/* Header with avatar */}
        <div className="flex items-start gap-4">
          {/* Large avatar */}
          <div className="relative">
            <div className={`w-20 h-20 rounded-full bg-gradient-to-br from-primary-500 to-cyan-500 flex items-center justify-center overflow-hidden ring-4 ${banner ? 'ring-midnight' : 'ring-card'} shadow-glow`}>
              {loading ? (
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : avatar ? (
                <img src={avatar} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <span className="text-white font-bold text-2xl">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            {/* Online indicator */}
            <div className={`absolute bottom-1 right-1 w-5 h-5 rounded-full border-4 border-midnight ${isOnline ? 'bg-success-500 shadow-glow-green' : 'bg-muted'
              }`} />
          </div>

          {/* User info */}
          <div className="flex-1 pt-2">
            <h2 className="text-xl font-bold text-white">
              {displayName}
            </h2>

            {/* NFT username badge */}
            {username && (
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-500/20 text-primary-400 border border-primary-500/30">
                  <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  NFT Domain
                </span>
              </div>
            )}

            {/* Wallet address */}
            <div className="flex items-center gap-2 mt-2">
              <code className="text-sm text-secondary bg-dark-200 px-2 py-1 rounded font-mono">
                {shortenAddress(profile?.walletAddress || walletAddress)}
              </code>
              <button
                onClick={() => copyToClipboard(profile?.walletAddress || walletAddress)}
                className="text-muted hover:text-white transition-colors"
                title="Copy address"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Bio */}
        {bio && (
          <div className="mt-4 p-4 bg-dark-200 border border-midnight rounded-lg">
            <p className="text-secondary text-sm leading-relaxed">{bio}</p>
          </div>
        )}

        {/* Custom records (social links, etc.) */}
        {Object.keys(records).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {records.twitter && (
              <a
                href={`https://twitter.com/${records.twitter}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-3 py-1.5 rounded-lg bg-dark-200 text-secondary hover:text-white hover:bg-dark-100 transition-colors text-sm"
              >
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                @{records.twitter}
              </a>
            )}
            {records.discord && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-dark-200 text-secondary text-sm">
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
                {records.discord}
              </span>
            )}
            {records.telegram && (
              <a
                href={`https://t.me/${records.telegram}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-3 py-1.5 rounded-lg bg-dark-200 text-secondary hover:text-white hover:bg-dark-100 transition-colors text-sm"
              >
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
                {records.telegram}
              </a>
            )}
            {records.website && (
              <a
                href={records.website.startsWith('http') ? records.website : `https://${records.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-3 py-1.5 rounded-lg bg-dark-200 text-secondary hover:text-white hover:bg-dark-100 transition-colors text-sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                Website
              </a>
            )}
            {records.email && (
              <a
                href={`mailto:${records.email}`}
                className="inline-flex items-center px-3 py-1.5 rounded-lg bg-dark-200 text-secondary hover:text-white hover:bg-dark-100 transition-colors text-sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Email
              </a>
            )}
          </div>
        )}

        {/* Subdomains */}
        {profile?.subdomains && profile.subdomains.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-muted mb-2">Subdomains:</p>
            <div className="flex flex-wrap gap-1">
              {profile.subdomains.map((sub, i) => (
                <span key={i} className="text-xs px-2 py-1 bg-dark-200 text-secondary rounded">
                  {sub}.{profile.mainDomain}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        {showActions && (
          <div className="mt-6 flex gap-3">
            {onMessage && (
              <button
                onClick={onMessage}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors font-medium shadow-glow"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Message
              </button>
            )}
            {onCall && (
              <button
                onClick={onCall}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-success-500 hover:bg-success-600 text-white rounded-lg transition-colors"
                title="Voice Call"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </button>
            )}
            {onVideoCall && (
              <button
                onClick={onVideoCall}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg transition-colors"
                title="Video Call"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Edit profile link */}
        {resolverUrl && (
          <div className="mt-4 pt-4 border-t border-midnight">
            <a
              href={resolverUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 text-sm text-secondary hover:text-primary-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Edit Profile on BlockStar Domains
            </a>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="mt-4 p-3 bg-danger-500/10 border border-danger-500/30 rounded-lg text-danger-400 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper functions
function shortenAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).then(() => {
    // Could show a toast notification here
    console.log('Copied to clipboard');
  });
}