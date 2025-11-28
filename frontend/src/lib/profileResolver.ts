// frontend/src/lib/profileResolver.ts
// BlockStar Cypher - NFT Domain Profile Resolver Client
// Fetches profile data from backend which reads from smart contract

const API_BASE = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
const RESOLVER_BASE = 'https://domains.blockstar.site';

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

// Local cache for profiles
const profileCache = new Map<string, { profile: BlockStarProfile; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Resolve NFT domain profile by username
 */
export async function resolveProfile(username: string): Promise<BlockStarProfile | null> {
  const cacheKey = username.toLowerCase();
  
  // Check local cache first
  const cached = profileCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.profile;
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/profile/resolve/${encodeURIComponent(username)}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success && data.profile) {
      // Cache locally
      profileCache.set(cacheKey, {
        profile: data.profile,
        expires: Date.now() + CACHE_TTL,
      });
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
};
