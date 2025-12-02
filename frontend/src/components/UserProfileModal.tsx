import React, { useEffect, useState } from 'react';
import { X, Globe, Mail, Twitter, ExternalLink, Copy, Check, UserPlus, UserMinus, MessageSquare } from 'lucide-react';
import { resolveProfile, getProfileByWallet, cacheProfileByWallet, type BlockStarProfile } from '@/lib/profileResolver';
import { truncateAddress, getInitials, getAvatarColor } from '@/utils/helpers';
import toast from 'react-hot-toast';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: string;
  onStartChat?: () => void;
  onAddContact?: () => void;
  onRemoveContact?: () => void;
  isContact?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

export default function UserProfileModal({
  isOpen,
  onClose,
  walletAddress,
  onStartChat,
  onAddContact,
  onRemoveContact,
  isContact = false,
}: UserProfileModalProps) {
  const [profile, setProfile] = useState<BlockStarProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !walletAddress) return;

    const loadProfile = async () => {
      setLoading(true);
      try {
        // First check local wallet cache (populated when @name was resolved)
        const cachedProfile = getProfileByWallet(walletAddress);
        if (cachedProfile) {
          setProfile(cachedProfile);
          setLoading(false);
          return;
        }
        
        // Try to get the NFT name from our backend
        const response = await fetch(`${API_URL}/api/profile/${walletAddress.toLowerCase()}`);
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.profile?.nftName) {
            // Resolve the full profile from the blockchain
            const fullProfile = await resolveProfile(data.profile.nftName);
            if (fullProfile) {
              // Cache this profile by wallet so ChatArea can find it
              cacheProfileByWallet(fullProfile);
              setProfile(fullProfile);
              setLoading(false);
              return;
            }
          }
        }

        // If no NFT name found, just show address
        setProfile(null);
      } catch (error) {
        console.error('Error loading profile:', error);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [isOpen, walletAddress]);

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    toast.success('Address copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-midnight rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        {/* Banner */}
        <div className="relative h-32 bg-gradient-to-br from-primary-500/30 to-cyan-500/30">
          {profile?.banner && (
            <img
              src={profile.banner}
              alt="Banner"
              className="w-full h-full object-cover"
            />
          )}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-2 bg-black/50 hover:bg-black/70 rounded-lg transition"
          >
            <X size={18} className="text-white" />
          </button>
        </div>

        {/* Avatar */}
        <div className="relative px-6">
          <div className="absolute -top-12 left-6">
            <div className="w-24 h-24 rounded-full border-4 border-card overflow-hidden bg-dark-200">
              {loading ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                </div>
              ) : profile?.avatar ? (
                <img
                  src={profile.avatar}
                  alt={profile.username || 'Avatar'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center text-white text-2xl font-bold"
                  style={{ backgroundColor: getAvatarColor(walletAddress) }}
                >
                  {getInitials(profile?.username || walletAddress)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="pt-16 px-6 pb-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Name & Username */}
              <div className="mb-4">
                {profile?.username ? (
                  <>
                    <h2 className="text-2xl font-bold text-white">@{profile.username}</h2>
                    {profile.fullUsername && profile.fullUsername !== profile.username && (
                      <p className="text-sm text-secondary">{profile.fullUsername}</p>
                    )}
                  </>
                ) : (
                  <h2 className="text-xl font-bold text-white">Unknown User</h2>
                )}
              </div>

              {/* Wallet Address */}
              <div className="mb-4">
                <button
                  onClick={handleCopyAddress}
                  className="flex items-center gap-2 px-3 py-2 bg-dark-200 hover:bg-midnight rounded-lg transition group"
                >
                  <span className="text-sm text-secondary font-mono">
                    {truncateAddress(walletAddress)}
                  </span>
                  {copied ? (
                    <Check size={14} className="text-success-500" />
                  ) : (
                    <Copy size={14} className="text-muted group-hover:text-white transition" />
                  )}
                </button>
              </div>

              {/* Bio */}
              {profile?.bio && (
                <div className="mb-4">
                  <p className="text-secondary">{profile.bio}</p>
                </div>
              )}

              {/* Social Links */}
              {profile?.records && Object.keys(profile.records).length > 0 && (
                <div className="mb-6 space-y-2">
                  {profile.records.website && (
                    <a
                      href={profile.records.website.startsWith('http') ? profile.records.website : `https://${profile.records.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-primary-400 hover:text-primary-300 transition"
                    >
                      <Globe size={16} />
                      <span className="truncate">{profile.records.website}</span>
                      <ExternalLink size={12} />
                    </a>
                  )}
                  {profile.records.email && (
                    <a
                      href={`mailto:${profile.records.email}`}
                      className="flex items-center gap-2 text-sm text-primary-400 hover:text-primary-300 transition"
                    >
                      <Mail size={16} />
                      <span>{profile.records.email}</span>
                    </a>
                  )}
                  {profile.records.twitter && (
                    <a
                      href={`https://twitter.com/${profile.records.twitter.replace('@', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-primary-400 hover:text-primary-300 transition"
                    >
                      <Twitter size={16} />
                      <span>@{profile.records.twitter.replace('@', '')}</span>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              )}

              {/* Subdomains */}
              {profile?.subdomains && profile.subdomains.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-secondary mb-2">Subdomains</h3>
                  <div className="flex flex-wrap gap-2">
                    {profile.subdomains.map((subdomain, index) => (
                      <span
                        key={index}
                        className="px-2 py-1 bg-dark-200 text-xs text-white rounded-lg"
                      >
                        {subdomain}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                {onStartChat && (
                  <button
                    onClick={() => {
                      onStartChat();
                      onClose();
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary-500 hover:bg-primary-600 text-white rounded-xl transition"
                  >
                    <MessageSquare size={18} />
                    Message
                  </button>
                )}
                
                {isContact ? (
                  onRemoveContact && (
                    <button
                      onClick={() => {
                        onRemoveContact();
                        onClose();
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-3 bg-danger-500/20 hover:bg-danger-500/30 text-danger-400 rounded-xl transition"
                    >
                      <UserMinus size={18} />
                    </button>
                  )
                ) : (
                  onAddContact && (
                    <button
                      onClick={() => {
                        onAddContact();
                        onClose();
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-3 bg-success-500/20 hover:bg-success-500/30 text-success-400 rounded-xl transition"
                    >
                      <UserPlus size={18} />
                    </button>
                  )
                )}
              </div>

              {/* View on Explorer */}
              <a
                href={`https://explorer.blockstar.one/address/${walletAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center justify-center gap-2 text-sm text-secondary hover:text-white transition"
              >
                View on Explorer
                <ExternalLink size={14} />
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
