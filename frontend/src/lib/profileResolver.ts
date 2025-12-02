// frontend/src/lib/profileResolver.ts
// BlockStar Cypher - NFT Domain Profile Resolver Client
// Fetches profile data from backend which reads from smart contract

const API_BASE = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
const RESOLVER_BASE = 'https://domains.blockstar.site';

// LocalStorage key for persisting wallet->profile mappings
const WALLET_PROFILE_CACHE_KEY = 'blockstar_wallet_profiles';

// Profile data from BlockStar Domains smart contract
export interface BlockStarProfile {
  username: string;           // e.g., "blockstar" or "sub.blockstar"
  fullUsername: string;       // e.g., "blockstar@blockstar"
  walletAddress: string;      // Owner wallet address
  avatar?: string;            // Profile image URL (from 'profile' record)
  banner?: string;            // Banner image URL
  bio?: string;               // User bio/description
  records: Record<string, string>; // All other custom records
  subdomains: string[];       // List of subdomains
  isSubdomain: boolean;       // Whether this is a subdomain
  mainDomain: string;         // Main domain name
  subDomain: string;          // Subdomain part (if applicable)
  resolvedAt: number;         // Timestamp when resolved
}

interface CachedProfile {
  profile: BlockStarProfile;
  expires: number;
}

// Local cache for profiles by username (memory only)
const profileCache = new Map<string, CachedProfile>();
// Additional cache by wallet address for reverse lookups (memory + localStorage)
const walletProfileCache = new Map<string, CachedProfile>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours for localStorage persistence

/**
 * Load wallet profile cache from localStorage on module init
 */
function loadCacheFromStorage(): void {
  if (typeof window === 'undefined') return;
  
  try {
    const stored = localStorage.getItem(WALLET_PROFILE_CACHE_KEY);
    if (stored) {
      const data: Record<string, CachedProfile> = JSON.parse(stored);
      const now = Date.now();
      
      for (const [wallet, cached] of Object.entries(data)) {
        // Only load non-expired entries
        if (cached.expires > now) {
          walletProfileCache.set(wallet.toLowerCase(), cached);
          // Also populate username cache
          if (cached.profile.username) {
            profileCache.set(cached.profile.username.toLowerCase(), cached);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error loading profile cache from storage:', error);
  }
}

/**
 * Save wallet profile cache to localStorage
 */
function saveCacheToStorage(): void {
  if (typeof window === 'undefined') return;
  
  try {
    const data: Record<string, CachedProfile> = {};
    const now = Date.now();
    
    walletProfileCache.forEach((cached, wallet) => {
      // Only save non-expired entries
      if (cached.expires > now) {
        data[wallet] = cached;
      }
    });
    
    localStorage.setItem(WALLET_PROFILE_CACHE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Error saving profile cache to storage:', error);
  }
}

// Load cache from localStorage on module initialization
loadCacheFromStorage();

/**
 * Cache a profile by both username and wallet address
 */
function cacheProfile(profile: BlockStarProfile): void {
  const expires = Date.now() + CACHE_TTL;
  
  // Cache by username (memory only)
  if (profile.username) {
    profileCache.set(profile.username.toLowerCase(), { profile, expires });
  }
  
  // Cache by wallet address for reverse lookups (memory + localStorage)
  if (profile.walletAddress) {
    walletProfileCache.set(profile.walletAddress.toLowerCase(), { profile, expires });
    // Persist to localStorage
    saveCacheToStorage();
  }
}

/**
 * Get profile by wallet address from cache
 */
export function getProfileByWallet(walletAddress: string): BlockStarProfile | null {
  const cached = walletProfileCache.get(walletAddress.toLowerCase());
  if (cached && cached.expires > Date.now()) {
    return cached.profile;
  }
  return null;
}

/**
 * Manually cache a profile by wallet address
 * Use this when you've already fetched a profile and want to make it available globally
 */
export function cacheProfileByWallet(profile: BlockStarProfile): void {
  if (!profile.walletAddress) return;
  
  const expires = Date.now() + CACHE_TTL;
  const cached = { profile, expires };
  
  walletProfileCache.set(profile.walletAddress.toLowerCase(), cached);
  
  // Also cache by username
  if (profile.username) {
    profileCache.set(profile.username.toLowerCase(), cached);
  }
  
  // Persist to localStorage
  saveCacheToStorage();
  
  console.log(`📋 Cached profile by wallet: ${profile.username || profile.walletAddress}`);
}

/**
 * Clear expired entries from cache
 */
export function clearExpiredProfiles(): void {
  const now = Date.now();
  
  walletProfileCache.forEach((cached, wallet) => {
    if (cached.expires <= now) {
      walletProfileCache.delete(wallet);
    }
  });
  
  profileCache.forEach((cached, username) => {
    if (cached.expires <= now) {
      profileCache.delete(username);
    }
  });
  
  saveCacheToStorage();
}

/**
 * Resolve NFT domain profile by username
 */
export async function resolveProfile(username: string): Promise<BlockStarProfile | null> {
  const cacheKey = username.toLowerCase();
  
  console.log(`🔍 [ProfileResolver] Resolving: "${username}" (cacheKey: "${cacheKey}")`);
  
  // Check local cache first
  const cached = profileCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    console.log(`📋 [ProfileResolver] Cache hit for: ${username}`);
    return cached.profile;
  }
  
  try {
    const url = `${API_BASE}/api/profile/resolve/${encodeURIComponent(username)}`;
    console.log(`🌐 [ProfileResolver] Fetching: ${url}`);
    
    const response = await fetch(url);
    
    console.log(`📥 [ProfileResolver] Response status: ${response.status}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        console.log(`❌ [ProfileResolver] Not found: ${username}`);
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log(`📦 [ProfileResolver] Response data:`, data.success ? 'success' : 'failed', data.profile?.walletAddress ? `wallet: ${data.profile.walletAddress}` : 'no wallet');
    
    if (data.success && data.profile) {
      // Cache by both username and wallet address
      cacheProfile(data.profile);
      return data.profile;
    }
    
    return null;
  } catch (error) {
    console.error('Error resolving profile:', error);
    return null;
  }
}

/**
 * Resolve multiple profiles at once
 */
export async function resolveProfiles(usernames: string[]): Promise<Map<string, BlockStarProfile>> {
  const results = new Map<string, BlockStarProfile>();
  const toFetch: string[] = [];
  
  // Check cache first
  for (const username of usernames) {
    const cached = profileCache.get(username.toLowerCase());
    if (cached && cached.expires > Date.now()) {
      results.set(username.toLowerCase(), cached.profile);
    } else {
      toFetch.push(username);
    }
  }
  
  if (toFetch.length === 0) {
    return results;
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/profile/resolve/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: toFetch }),
    });
    
    if (response.ok) {
      const data = await response.json();
      
      for (const [username, value] of Object.entries(data)) {
        if ((value as any).profile) {
          const profile = (value as any).profile as BlockStarProfile;
          results.set(username, profile);
          profileCache.set(username, {
            profile,
            expires: Date.now() + CACHE_TTL,
          });
        }
      }
    }
  } catch (error) {
    console.error('Error resolving profiles:', error);
  }
  
  return results;
}

/**
 * Get the resolver URL for viewing/editing profile on BlockStar Domains
 */
export function getResolverUrl(username: string): string {
  const nftUsername = extractNftUsername(username);
  // Note: URL uses "reslover" (as shown in user's site)
  return `${RESOLVER_BASE}/reslover/${nftUsername}`;
}

/**
 * Extract domain name from full username (e.g., "blockstar@blockstar" -> "blockstar")
 */
export function extractNftUsername(fullUsername: string): string {
  if (fullUsername.includes('@')) {
    return fullUsername.split('@')[0];
  }
  return fullUsername;
}

/**
 * Check if username is a BlockStar NFT domain
 */
export function isBlockStarDomain(username: string): boolean {
  return username.toLowerCase().endsWith('@blockstar');
}

/**
 * Format username for display
 */
export function formatUsername(username: string): string {
  if (isBlockStarDomain(username)) {
    return username;
  }
  // If it's just the name part, add @blockstar
  if (!username.includes('@') && !username.startsWith('0x')) {
    return `${username}@blockstar`;
  }
  return username;
}

/**
 * Clear local profile cache
 */
export function clearProfileCache(username?: string): void {
  if (username) {
    profileCache.delete(username.toLowerCase());
  } else {
    profileCache.clear();
  }
}

/**
 * Get cached profile (without fetching)
 */
export function getCachedProfile(username: string): BlockStarProfile | null {
  const cached = profileCache.get(username.toLowerCase());
  if (cached && cached.expires > Date.now()) {
    return cached.profile;
  }
  return null;
}

export default {
  resolveProfile,
  resolveProfiles,
  getResolverUrl,
  extractNftUsername,
  isBlockStarDomain,
  formatUsername,
  clearProfileCache,
  getCachedProfile,
  cacheProfileByWallet,
};
