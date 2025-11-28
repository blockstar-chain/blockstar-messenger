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

// BlockStar Domains Contract ABI (minimal ABI for the methods we need)
const CONTRACT_ABI = [
  // Get unified records for a domain
  {
    "inputs": [
      { "internalType": "string", "name": "name", "type": "string" },
      { "internalType": "string", "name": "subdomain", "type": "string" }
    ],
    "name": "getUnifiedRecords",
    "outputs": [
      { "internalType": "string[]", "name": "keys", "type": "string[]" },
      { "internalType": "string[]", "name": "values", "type": "string[]" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  // Get token ID from name
  {
    "inputs": [
      { "internalType": "string", "name": "name", "type": "string" }
    ],
    "name": "getNameToTokenId",
    "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
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
  // Get all subdomains
  {
    "inputs": [
      { "internalType": "string", "name": "name", "type": "string" }
    ],
    "name": "getAllSubdomains",
    "outputs": [
      { "internalType": "string[]", "name": "", "type": "string[]" }
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

const profileCache = new Map<string, { profile: BlockStarProfile; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
    console.log(`📋 Profile cache hit for: ${name}`);
    return cached.profile;
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
    
    // Parse domain name (handle subdomains like "sub.domain")
    const splitName = name.trim().split('.');
    let domainName = '';
    let subDomain = '';
    let isSubdomain = false;
    
    if (splitName.length === 1) {
      domainName = splitName[0];
    } else if (splitName.length > 1) {
      domainName = splitName[1];
      subDomain = splitName[0];
      isSubdomain = true;
    }
    
    // Fetch records from smart contract with timeout
    let records;
    try {
      const recordsPromise = domainContract.getUnifiedRecords(domainName, subDomain);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('RPC timeout')), 10000)
      );
      records = await Promise.race([recordsPromise, timeoutPromise]);
    } catch (rpcError) {
      console.error('RPC call failed for getUnifiedRecords:', rpcError);
      return null;
    }
    
    // Get token ID and owner
    let owner = '';
    try {
      const tokenId = await domainContract.getNameToTokenId(domainName);
      if (tokenId && tokenId > 0) {
        owner = await domainContract.ownerOf(tokenId);
      }
    } catch (err) {
      console.log('Could not get owner:', err);
    }
    
    // Get subdomains
    let subdomains: string[] = [];
    try {
      subdomains = await domainContract.getAllSubdomains(domainName);
    } catch (err) {
      console.log('Could not get subdomains:', err);
    }
    
    // Parse records into profile
    const profile = parseRecords(
      records,
      name,
      owner,
      subdomains,
      isSubdomain,
      domainName,
      subDomain
    );
    
    // Cache the result
    profileCache.set(cacheKey, {
      profile,
      expires: Date.now() + CACHE_TTL,
    });
    
    console.log(`✅ Profile resolved for: ${name}`);
    return profile;
    
  } catch (error) {
    console.error(`❌ Error resolving profile for ${name}:`, error);
    return null;
  }
}

/**
 * Parse contract records into BlockStarProfile
 */
function parseRecords(
  records: [string[], string[]],
  name: string,
  owner: string,
  subdomains: string[],
  isSubdomain: boolean,
  mainDomain: string,
  subDomain: string
): BlockStarProfile {
  const keys = records[0] || [];
  const values = records[1] || [];
  
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
        customRecords[key] = value;
    }
  });
  
  return {
    username: name,
    fullUsername: `${name}@blockstar`,
    walletAddress: owner,
    avatar,
    banner,
    bio,
    records: customRecords,
    subdomains: subdomains || [],
    isSubdomain,
    mainDomain,
    subDomain,
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
