// backend/src/services/profileResolver.ts
// BlockStar Cypher - On-Chain NFT Domain Profile Resolver
// Fetches user profile data directly from BlockStar Domains smart contract

import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

// ============================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================

// RPC URL for the blockchain - BlockStar Mainnet
const RPC_URL = process.env.BLOCKCHAIN_RPC_URL || 'https://mainnet-rpc.blockstar.one';

// BlockStar Domains Contract Address
const CONTRACT_ADDRESS = process.env.DOMAINS_CONTRACT_ADDRESS || '0x1E9248a78352150e8b2E7E728346EDd41A77FDeA';

// BlockStar Domains V3 Contract ABI (minimal ABI for the methods we need)
const DEFAULT_TLD = process.env.DEFAULT_TLD || 'blockstar';

const CONTRACT_ABI = [
  // Get all records for a domain (V3: name + tld)
  {
    "inputs": [
      { "internalType": "string", "name": "name", "type": "string" },
      { "internalType": "string", "name": "tld", "type": "string" }
    ],
    "name": "getAllRecords",
    "outputs": [
      { "internalType": "string[]", "name": "keys", "type": "string[]" },
      { "internalType": "string[]", "name": "values", "type": "string[]" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  // Get domain info (owner, expiration, expired, tokenId) in one call
  {
    "inputs": [
      { "internalType": "string", "name": "name", "type": "string" },
      { "internalType": "string", "name": "tld", "type": "string" }
    ],
    "name": "getDomainInfo",
    "outputs": [
      { "internalType": "address", "name": "domainOwner", "type": "address" },
      { "internalType": "uint256", "name": "expiration", "type": "uint256" },
      { "internalType": "bool", "name": "expired", "type": "bool" },
      { "internalType": "uint256", "name": "tokenId", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  // Get metadata (description, image) by tokenId
  {
    "inputs": [
      { "internalType": "uint256", "name": "tokenId", "type": "uint256" }
    ],
    "name": "getMetadata",
    "outputs": [
      { "internalType": "string", "name": "description", "type": "string" },
      { "internalType": "string", "name": "image", "type": "string" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  // Get owner of token
  {
    "inputs": [
      { "internalType": "uint256", "name": "tokenId", "type": "uint256" }
    ],
    "name": "ownerOf",
    "outputs": [
      { "internalType": "address", "name": "", "type": "address" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  // Get primary name for an address
  {
    "inputs": [
      { "internalType": "address", "name": "addr", "type": "address" }
    ],
    "name": "getPrimaryName",
    "outputs": [
      { "internalType": "string", "name": "name", "type": "string" },
      { "internalType": "string", "name": "tld", "type": "string" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

// BlockStar Domains Resolver Web URL (for "Edit Profile" links)
const RESOLVER_WEB_URL = process.env.RESOLVER_URL || 'https://domains.blockstar.site';

// ============================================
// TYPES
// ============================================

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

// ============================================
// CACHE
// ============================================

// Cache for public keys (in-memory)
const profileCache = new Map<string, { profile: BlockStarProfile; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const RPC_TIMEOUT = 15000; // 15 seconds

// ============================================
// PROVIDER & CONTRACT
// ============================================

let provider: ethers.JsonRpcProvider | null = null;
let contract: ethers.Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    console.log('📡 Connected to blockchain RPC:', RPC_URL);
  }
  return provider;
}

function getContract(): ethers.Contract {
  if (!contract) {
    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, getProvider());
    console.log('📜 Connected to BlockStar Domains contract:', CONTRACT_ADDRESS);
  }
  return contract;
}

// ============================================
// MAIN RESOLVER FUNCTION
// ============================================

/**
 * Resolve NFT domain profile from smart contract
 * @param name - The domain name (e.g., "blockstar" or "sub.blockstar")
 */
export async function resolveProfile(name: string): Promise<BlockStarProfile | null> {
  if (!name || name.trim().length === 0) {
    console.log('❌ Empty name provided to resolveProfile');
    return null;
  }
  
  const cacheKey = name.toLowerCase().trim();
  
  // Check cache first
  const cached = profileCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    // Validate cached profile has walletAddress
    if (cached.profile && cached.profile.walletAddress) {
      console.log(`📋 Profile cache hit for: ${name} (wallet: ${cached.profile.walletAddress})`);
      return cached.profile;
    } else {
      // Invalid cached profile - clear and re-fetch
      console.log(`⚠️ Invalid cached profile for ${name} (missing walletAddress) - clearing cache`);
      profileCache.delete(cacheKey);
    }
  }
  
  try {
    console.log(`🔍 Resolving on-chain profile for: ${name}`);
    
    let domainContract;
    try {
      domainContract = getContract();
    } catch (contractError) {
      console.error('Failed to get contract:', contractError);
      return null;
    }
    
    // V3: Domain names are name + TLD (no subdomain concept)
    // Parse input: "name" or "name@tld" or "name.tld"
    let domainName = name.trim();
    let tld = DEFAULT_TLD;
    
    if (domainName.includes('@')) {
      const parts = domainName.split('@');
      domainName = parts[0];
      tld = parts[1] || DEFAULT_TLD;
    } else if (domainName.includes('.')) {
      const parts = domainName.split('.');
      domainName = parts[0];
      tld = parts[1] || DEFAULT_TLD;
    }
    
    // V3: Use getDomainInfo to get owner, tokenId, expiration in one call
    let owner = '';
    let tokenId: bigint | null = null;
    try {
      const domainInfoPromise = domainContract.getDomainInfo(domainName, tld);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('RPC timeout')), RPC_TIMEOUT)
      );
      const domainInfo = await Promise.race([domainInfoPromise, timeoutPromise]) as any;
      
      owner = domainInfo.domainOwner || domainInfo[0] || '';
      tokenId = domainInfo.tokenId || domainInfo[3] || null;
      const expired = domainInfo.expired ?? domainInfo[2] ?? false;
      
      console.log(`🔍 Domain info for ${domainName}.${tld}: owner=${owner}, tokenId=${tokenId?.toString()}, expired=${expired}`);
      
      // If domain is expired or owner is zero address, treat as not found
      if (expired || !owner || owner === '0x0000000000000000000000000000000000000000') {
        console.log(`❌ Domain ${domainName}.${tld} is expired or not minted`);
        return null;
      }
    } catch (err: any) {
      console.error('Could not get domain info:', err?.message || err);
      return null;
    }
    
    // V3: Fetch records using getAllRecords(name, tld)
    let records;
    try {
      const recordsPromise = domainContract.getAllRecords(domainName, tld);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('RPC timeout')), RPC_TIMEOUT)
      );
      records = await Promise.race([recordsPromise, timeoutPromise]);
    } catch (rpcError: any) {
      console.error('RPC call failed for getAllRecords:', rpcError?.message || rpcError);
      // Continue with empty records rather than failing entirely
      records = [[], []];
    }
    
    // V3: Fetch metadata (description, image) from contract if tokenId exists
    let metaDescription = '';
    let metaImage = '';
    if (tokenId && tokenId > 0n) {
      try {
        const metadata = await domainContract.getMetadata(tokenId);
        metaDescription = metadata.description || metadata[0] || '';
        metaImage = metadata.image || metadata[1] || '';
        console.log(`🔍 Metadata for tokenId ${tokenId}: desc=${metaDescription ? 'yes' : 'no'}, image=${metaImage ? 'yes' : 'no'}`);
      } catch (err) {
        console.log('Could not get metadata:', err);
      }
    }
    
    // Parse records into profile - with fallback if record parsing fails
    let profile: BlockStarProfile;
    try {
      profile = parseRecords(
        records,
        domainName,
        tld,
        owner,
        metaDescription,
        metaImage
      );
    } catch (parseError) {
      console.log(`⚠️ Record parsing failed for ${name}, creating minimal profile:`, parseError);
      // Create minimal profile with just wallet address
      profile = {
        username: domainName,
        fullUsername: `${domainName}@${tld}`,
        walletAddress: owner,
        avatar: '',
        banner: '',
        bio: '',
        records: {},
        subdomains: [],
        isSubdomain: false,
        mainDomain: domainName,
        subDomain: '',
        resolvedAt: Date.now(),
      };
    }
    
    // Double-check profile has walletAddress before caching
    if (!profile.walletAddress) {
      console.log(`❌ Profile parsed but missing walletAddress for ${name}`);
      return null;
    }
    
    // Cache the result
    profileCache.set(cacheKey, {
      profile,
      expires: Date.now() + CACHE_TTL,
    });
    
    console.log(`✅ Profile resolved for: ${name} (wallet: ${profile.walletAddress})`);
    return profile;
    
  } catch (error) {
    console.error(`❌ Error resolving profile for ${name}:`, error);
    return null;
  }
}

/**
 * Convert IPFS hash to full URL
 */
function ipfsToUrl(input: any): string | null {
  if (!input || typeof input !== 'string') return null;
  let hash = input.trim();
  // Match IPFS hash (typically starts with Qm or bafy and is 46+ chars)
  const ipfsHashRegex = /(?:ipfs:\/\/|\/ipfs\/)?([a-zA-Z0-9]{46,})/;
  const match = hash.match(ipfsHashRegex);
  if (match && match[1]) {
    return 'https://alchemy.mypinata.cloud/ipfs/' + match[1];
  }
  return null; // Not a valid IPFS input
}

/**
 * Safely convert ethers Result to plain array, handling decode errors
 */
function safeArrayFrom(result: any): string[] {
  if (!result) return [];
  
  const arr: string[] = [];
  try {
    // Try to get length
    const len = result.length || 0;
    for (let i = 0; i < len; i++) {
      try {
        const val = result[i];
        arr.push(typeof val === 'string' ? val : String(val || ''));
      } catch (itemError) {
        // If individual item fails to decode, use empty string
        console.log(`⚠️ Could not decode record at index ${i}:`, itemError);
        arr.push('');
      }
    }
  } catch (err) {
    console.log('⚠️ Could not iterate result:', err);
  }
  return arr;
}

/**
 * Parse contract records into BlockStarProfile (V3)
 */
function parseRecords(
  records: [string[], string[]],
  domainName: string,
  tld: string,
  owner: string,
  metaDescription: string,
  metaImage: string
): BlockStarProfile {
  // Safely convert ethers Result objects to plain arrays
  const keys: string[] = safeArrayFrom(records?.[0]);
  const values: string[] = safeArrayFrom(records?.[1]);
  
  console.log(`🔍 Parsed ${keys.length} keys and ${values.length} values for ${domainName}.${tld}`);
  
  let avatar = '';
  let banner = '';
  let bio = '';
  const customRecords: Record<string, string> = {};
  
  // Parse records
  keys.forEach((key, index) => {
    const value = values[index] || '';
    
    switch (key.toLowerCase()) {
      case 'profile':
      case 'avatar':
      case 'pfp':
        avatar = value;
        break;
      case 'banner':
      case 'cover':
        banner = value;
        break;
      case 'bio':
      case 'description':
      case 'about':
        bio = value;
        break;
      default:
        // Store all other records
        if (key) {
          customRecords[key] = value;
        }
    }
  });
  
  // V3: Use metadata image/description as fallback if records don't have them
  if (!avatar && metaImage) {
    avatar = metaImage;
  }
  if (!bio && metaDescription) {
    bio = metaDescription;
  }
  
  return {
    username: domainName,
    fullUsername: `${domainName}@${tld}`,
    walletAddress: owner,
    avatar: ipfsToUrl(avatar) || avatar, // Convert IPFS hash to URL, fallback to original
    banner: ipfsToUrl(banner) || banner, // Convert IPFS hash to URL, fallback to original
    bio,
    records: customRecords,
    subdomains: [],       // V3: No subdomain support
    isSubdomain: false,   // V3: No subdomain support
    mainDomain: domainName,
    subDomain: '',
    resolvedAt: Date.now(),
  };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Resolve multiple profiles at once
 */
export async function resolveProfiles(names: string[]): Promise<Map<string, BlockStarProfile>> {
  const results = new Map<string, BlockStarProfile>();
  
  await Promise.all(
    names.map(async (name) => {
      const profile = await resolveProfile(name);
      if (profile) {
        results.set(name.toLowerCase(), profile);
      }
    })
  );
  
  return results;
}

/**
 * Get resolver URL for a username (for linking to resolver page)
 */
export function getResolverUrl(name: string): string {
  // Note: URL uses "reslover" (as shown in user's site)
  return `${RESOLVER_WEB_URL}/reslover/${name}`;
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
 * Check if a username is a valid BlockStar NFT domain
 */
export function isBlockStarDomain(username: string): boolean {
  return username.toLowerCase().endsWith('@blockstar');
}

/**
 * Clear profile cache
 */
export function clearProfileCache(name?: string): void {
  if (name) {
    profileCache.delete(name.toLowerCase());
  } else {
    profileCache.clear();
  }
}

/**
 * Check if contract is configured
 */
export function isContractConfigured(): boolean {
  return CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000';
}

/**
 * Get contract info
 */
export function getContractInfo(): { address: string; rpcUrl: string; configured: boolean } {
  return {
    address: CONTRACT_ADDRESS,
    rpcUrl: RPC_URL,
    configured: isContractConfigured(),
  };
}

// ============================================
// EXPORTS
// ============================================

export default {
  resolveProfile,
  resolveProfiles,
  getResolverUrl,
  extractNftUsername,
  isBlockStarDomain,
  clearProfileCache,
  isContractConfigured,
  getContractInfo,
};