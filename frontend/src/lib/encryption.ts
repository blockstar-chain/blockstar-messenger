import { x25519 } from '@noble/curves/ed25519';

/**
 * End-to-End Encryption Service with Wallet-Derived Keys (X25519)
 * 
 * FIXED: Now uses truly deterministic key derivation!
 * 
 * How it works:
 * 1. User connects wallet and signs a fixed message
 * 2. Signature is hashed to get 32 bytes (private key seed)
 * 3. X25519 derives public key from private key deterministically
 * 4. Same wallet = same signature = same keys on ANY device!
 * 
 * Security model:
 * - Private key never leaves the device
 * - Server only stores public keys
 * - Messages encrypted with ECDH shared secret + AES-GCM
 * - Same wallet can decrypt on any device (re-derive keys)
 */

// API base URL
const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

// Cache for public keys (in-memory)
const publicKeyCache = new Map<string, { key: string | null; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const NEGATIVE_CACHE_TTL = 30 * 1000; // 30 seconds for "not found" results

// The message we ask users to sign to derive keys
// This MUST stay constant - changing it would invalidate all keys!
const KEY_DERIVATION_MESSAGE = 'BlockStar Cypher - Secure Key Derivation v2\n\nSigning this message generates your encryption keys.\nThis does NOT cost any gas or make any transactions.\n\nYour keys will be the same on all your devices.';

// Browser-compatible base64 utilities
function uint8ArrayToBase64(array: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < array.length; i++) {
    binary += String.fromCharCode(array[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Convert hex string to Uint8Array
function hexToUint8Array(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  return bytes;
}

export class EncryptionService {
  private privateKey: Uint8Array | null = null;
  private publicKey: Uint8Array | null = null;
  private userAddress: string | null = null;
  private publicKeyBase64: string | null = null;
  private signMessageFn: ((message: string) => Promise<string>) | null = null;

  /**
   * Check if encryption service is initialized and ready
   */
  isReady(): boolean {
    return this.privateKey !== null && this.publicKey !== null;
  }

  /**
   * Set the wallet sign function (from wagmi/ethers)
   */
  setSignFunction(signFn: (message: string) => Promise<string>): void {
    this.signMessageFn = signFn;
  }

  /**
   * Initialize encryption with wallet-derived keys
   * This ensures same keys on every device with same wallet
   */
  async initialize(walletAddress: any, signMessage?: (message: string) => Promise<string>): Promise<void> {
    this.userAddress = walletAddress.toLowerCase();
    
    if (signMessage) {
      this.signMessageFn = signMessage;
    }

    // Check if we have cached keys in localStorage (faster startup)
    const cachedPrivateKey = localStorage.getItem(`blockstar_x25519_priv_${this.userAddress}`);
    const cachedPublicKey = localStorage.getItem(`blockstar_x25519_pub_${this.userAddress}`);
    
    if (cachedPrivateKey && cachedPublicKey) {
      try {
        this.privateKey = base64ToUint8Array(cachedPrivateKey);
        this.publicKey = base64ToUint8Array(cachedPublicKey);
        this.publicKeyBase64 = cachedPublicKey;
        
        // Verify the keys are valid by checking public key derivation
        const derivedPub = x25519.getPublicKey(this.privateKey);
        if (uint8ArrayToBase64(derivedPub) === cachedPublicKey) {
          console.log('🔐 Loaded cached X25519 keys for', this.userAddress);
          await this.registerPublicKey();
          return;
        } else {
          console.warn('⚠️ Cached keys invalid, re-deriving...');
        }
      } catch (error) {
        console.warn('⚠️ Failed to load cached keys:', error);
      }
    }

    // Derive new keys from wallet signature
    if (this.signMessageFn) {
      console.log('🔐 Deriving X25519 keys from wallet signature...');
      await this.deriveKeysFromWallet();
    } else {
      // Fallback: generate random keys (won't sync across devices)
      console.warn('⚠️ No sign function available, generating random keys (won\'t sync across devices)');
      await this.generateRandomKeys();
    }

    // Register public key with server
    await this.registerPublicKey();
  }

  /**
   * Derive DETERMINISTIC encryption keys from wallet signature
   * 
   * This is the key fix! The same wallet will always produce the same keys:
   * 1. Sign a fixed message with wallet
   * 2. Hash the signature to get 32 bytes
   * 3. Use those 32 bytes as X25519 private key
   * 4. Derive public key deterministically
   */
  private async deriveKeysFromWallet(): Promise<void> {
    if (!this.signMessageFn || !this.userAddress) {
      throw new Error('Sign function not available');
    }

    try {
      // Ask wallet to sign the derivation message
      // Same wallet + same message = same signature = same keys!
      const signature = await this.signMessageFn(KEY_DERIVATION_MESSAGE);
      
      // Convert signature to bytes
      const signatureBytes = hexToUint8Array(signature);
      
      // Hash the signature to get exactly 32 bytes for X25519 private key
      // Using SHA-256 ensures we always get 32 bytes regardless of signature format
      const hashBuffer = await crypto.subtle.digest('SHA-256', signatureBytes);
      this.privateKey = new Uint8Array(hashBuffer);
      
      // X25519 deterministically derives public key from private key
      // This is the magic - same private key = same public key, always!
      this.publicKey = x25519.getPublicKey(this.privateKey);
      this.publicKeyBase64 = uint8ArrayToBase64(this.publicKey);
      
      // Cache keys locally for faster startup
      localStorage.setItem(`blockstar_x25519_priv_${this.userAddress}`, uint8ArrayToBase64(this.privateKey));
      localStorage.setItem(`blockstar_x25519_pub_${this.userAddress}`, this.publicKeyBase64);
      
      console.log('🔐 X25519 keys derived from wallet signature');
      console.log('🔑 Public key:', this.publicKeyBase64.substring(0, 20) + '...');
    } catch (error) {
      console.error('Failed to derive keys from wallet:', error);
      // Fall back to random keys
      await this.generateRandomKeys();
    }
  }

  /**
   * Generate random keys (fallback, won't sync across devices)
   */
  private async generateRandomKeys(): Promise<void> {
    // Generate random 32 bytes for private key
    this.privateKey = crypto.getRandomValues(new Uint8Array(32));
    this.publicKey = x25519.getPublicKey(this.privateKey);
    this.publicKeyBase64 = uint8ArrayToBase64(this.publicKey);
    
    // Cache locally
    if (this.userAddress) {
      localStorage.setItem(`blockstar_x25519_priv_${this.userAddress}`, uint8ArrayToBase64(this.privateKey));
      localStorage.setItem(`blockstar_x25519_pub_${this.userAddress}`, this.publicKeyBase64);
    }
    
    console.log('🔐 Generated random X25519 keys (device-specific)');
  }

  /**
   * Re-derive keys on a new device using wallet signature
   */
  async rederiveKeys(): Promise<boolean> {
    if (!this.signMessageFn || !this.userAddress) {
      return false;
    }

    try {
      console.log('🔐 Re-deriving X25519 keys...');
      
      // Clear cached keys first
      localStorage.removeItem(`blockstar_x25519_priv_${this.userAddress}`);
      localStorage.removeItem(`blockstar_x25519_pub_${this.userAddress}`);
      
      await this.deriveKeysFromWallet();
      await this.registerPublicKey();
      return true;
    } catch (error) {
      console.error('Failed to re-derive keys:', error);
      return false;
    }
  }

  /**
   * Register public key with the key exchange server
   */
  private async registerPublicKey(): Promise<void> {
    if (!this.publicKeyBase64 || !this.userAddress) return;

    try {
      const response = await fetch(`${API_URL}/api/keys/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          walletAddress: this.userAddress,
          publicKey: this.publicKeyBase64,
        }),
      });

      if (!response.ok) {
        console.error('Failed to register public key:', await response.text());
      } else {
        console.log('🔑 Public key registered with server');
      }
    } catch (error) {
      console.error('Error registering public key:', error);
    }
  }

  /**
   * Clear the public key cache for an address (useful when user comes online)
   */
  clearKeyCache(walletAddress: string): void {
    const address = walletAddress.toLowerCase();
    publicKeyCache.delete(address);
    console.log('🔑 Cleared key cache for', address);
  }

  /**
   * Fetch a user's public key from the server
   */
  async fetchPublicKey(walletAddress: string): Promise<string | null> {
    const address = walletAddress.toLowerCase();

    // Check cache first
    const cached = publicKeyCache.get(address);
    if (cached) {
      // Use different TTL for found vs not-found results
      const ttl = cached.key ? CACHE_TTL : NEGATIVE_CACHE_TTL;
      if (Date.now() - cached.timestamp < ttl) {
        return cached.key;
      }
    }

    try {
      const response = await fetch(`${API_URL}/api/keys/${address}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          console.warn(`No public key found for ${address}`);
          // Cache the negative result with shorter TTL
          publicKeyCache.set(address, { key: null, timestamp: Date.now() });
          return null;
        }
        throw new Error('Failed to fetch public key');
      }

      const data = await response.json();
      
      if (data.publicKey) {
        // Cache the key
        publicKeyCache.set(address, {
          key: data.publicKey,
          timestamp: Date.now(),
        });
        return data.publicKey;
      }

      // No key in response - cache negative result
      publicKeyCache.set(address, { key: null, timestamp: Date.now() });
      return null;
    } catch (error) {
      console.error('Error fetching public key:', error);
      return null;
    }
  }

  /**
   * Fetch multiple public keys at once
   */
  async fetchPublicKeys(walletAddresses: string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    const toFetch: string[] = [];

    // Check cache first
    for (const address of walletAddresses) {
      const normalized = address.toLowerCase();
      const cached = publicKeyCache.get(normalized);
      if (cached && Date.now() - cached.timestamp < (cached.key ? CACHE_TTL : NEGATIVE_CACHE_TTL)) {
        results.set(normalized, cached.key);
      } else {
        toFetch.push(normalized);
      }
    }

    // Fetch missing keys
    if (toFetch.length > 0) {
      try {
        const response = await fetch(`${API_URL}/api/keys/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addresses: toFetch }),
        });

        if (response.ok) {
          const data = await response.json();
          for (const user of data.users || []) {
            const addr = user.walletAddress.toLowerCase();
            publicKeyCache.set(addr, {
              key: user.publicKey || null,
              timestamp: Date.now(),
            });
            results.set(addr, user.publicKey || null);
          }
        }
      } catch (error) {
        console.error('Error fetching batch keys:', error);
      }

      // Mark unfetched as null
      for (const addr of toFetch) {
        if (!results.has(addr)) {
          publicKeyCache.set(addr, { key: null, timestamp: Date.now() });
          results.set(addr, null);
        }
      }
    }

    return results;
  }

  /**
   * Get public key for sharing with contacts
   */
  async getPublicKey(): Promise<string> {
    if (this.publicKeyBase64) {
      return this.publicKeyBase64;
    }

    if (!this.publicKey) {
      throw new Error('Encryption not initialized');
    }

    this.publicKeyBase64 = uint8ArrayToBase64(this.publicKey);
    return this.publicKeyBase64;
  }

  /**
   * Encrypt a message for a recipient (fetches key automatically)
   */
  async encryptForRecipient(
    message: string,
    recipientAddress: string
  ): Promise<{ encrypted: string; error?: string }> {
    // Fetch recipient's public key
    const recipientPublicKey = await this.fetchPublicKey(recipientAddress);
    
    if (!recipientPublicKey) {
      return {
        encrypted: message, // Fall back to plaintext
        error: 'Recipient public key not found - message sent unencrypted',
      };
    }

    try {
      const encrypted = await this.encryptMessage(message, recipientPublicKey);
      return { encrypted };
    } catch (error) {
      console.error('Encryption failed:', error);
      return {
        encrypted: message,
        error: 'Encryption failed - message sent unencrypted',
      };
    }
  }

  /**
   * Decrypt a message from a sender (fetches key automatically)
   */
  async decryptFromSender(
    encryptedMessage: string,
    senderAddress: string
  ): Promise<{ decrypted: string; wasEncrypted: boolean; decryptionFailed?: boolean }> {
    // Check if message looks like base64 encrypted content
    const looksEncrypted = /^[A-Za-z0-9+/=]+$/.test(encryptedMessage) && 
                          encryptedMessage.length > 20 &&
                          !encryptedMessage.includes(' ');

    if (!looksEncrypted) {
      return { decrypted: encryptedMessage, wasEncrypted: false };
    }

    // Fetch sender's public key
    const senderPublicKey = await this.fetchPublicKey(senderAddress);
    
    if (!senderPublicKey) {
      // Can't decrypt without sender's key - show meaningful message
      console.warn('Cannot decrypt: public key not found for', senderAddress);
      return { 
        decrypted: '🔒 [Encrypted - key not found]', 
        wasEncrypted: true,
        decryptionFailed: true 
      };
    }

    try {
      const decrypted = await this.decryptMessage(encryptedMessage, senderPublicKey);
      return { decrypted, wasEncrypted: true };
    } catch (error: any) {
      // Decryption failed - likely key mismatch from key regeneration
      console.warn('Decryption failed for message. This usually means encryption keys were regenerated.');
      console.warn('Error:', error?.message || error);
      
      return { 
        decrypted: '🔒 [Cannot decrypt - keys changed]', 
        wasEncrypted: true,
        decryptionFailed: true 
      };
    }
  }

  /**
   * Encrypt a message for a recipient using X25519 + AES-GCM
   * 
   * Process:
   * 1. Compute shared secret using X25519 ECDH
   * 2. Derive AES key from shared secret using HKDF
   * 3. Encrypt message with AES-GCM
   * 4. Prepend IV to ciphertext
   */
  async encryptMessage(
    message: string,
    recipientPublicKey: string
  ): Promise<string> {
    if (!this.privateKey) {
      throw new Error('Encryption not initialized');
    }

    try {
      // Decode recipient's public key
      const recipientPubBytes = base64ToUint8Array(recipientPublicKey);
      
      // Compute X25519 shared secret
      const sharedSecret = x25519.getSharedSecret(this.privateKey, recipientPubBytes);
      
      // Derive AES-256 key from shared secret using HKDF
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        sharedSecret,
        'HKDF',
        false,
        ['deriveKey']
      );
      
      const aesKey = await crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: new TextEncoder().encode('blockstar-e2e-v2'),
          info: new TextEncoder().encode('aes-gcm-key'),
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
      );

      // Generate random IV
      const iv = crypto.getRandomValues(new Uint8Array(12));

      // Encrypt message
      const encoder = new TextEncoder();
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        encoder.encode(message)
      );

      // Combine IV and encrypted data
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encrypted), iv.length);

      return uint8ArrayToBase64(combined);
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt message');
    }
  }

  /**
   * Decrypt a message from a sender using X25519 + AES-GCM
   */
  async decryptMessage(
    encryptedMessage: string,
    senderPublicKey: string
  ): Promise<string> {
    if (!this.privateKey) {
      throw new Error('Encryption not initialized');
    }

    try {
      // Decode sender's public key
      const senderPubBytes = base64ToUint8Array(senderPublicKey);
      
      // Compute X25519 shared secret
      const sharedSecret = x25519.getSharedSecret(this.privateKey, senderPubBytes);
      
      // Derive AES-256 key from shared secret using HKDF
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        sharedSecret,
        'HKDF',
        false,
        ['deriveKey']
      );
      
      const aesKey = await crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: new TextEncoder().encode('blockstar-e2e-v2'),
          info: new TextEncoder().encode('aes-gcm-key'),
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      // Extract IV and encrypted data
      const combined = base64ToUint8Array(encryptedMessage);
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);

      // Decrypt message
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        encrypted
      );

      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt message');
    }
  }

  /**
   * Get user's address
   */
  getUserAddress(): string | null {
    return this.userAddress;
  }

  /**
   * Clean up encryption keys from memory (not storage)
   */
  destroy(): void {
    // Zero out private key in memory for security
    if (this.privateKey) {
      this.privateKey.fill(0);
    }
    this.privateKey = null;
    this.publicKey = null;
    this.userAddress = null;
    this.publicKeyBase64 = null;
  }

  /**
   * Clear all stored keys for a user (for logout/reset)
   */
  clearStoredKeys(): void {
    if (this.userAddress) {
      localStorage.removeItem(`blockstar_x25519_priv_${this.userAddress}`);
      localStorage.removeItem(`blockstar_x25519_pub_${this.userAddress}`);
      // Also clear old format keys
      localStorage.removeItem(`blockstar_keys_${this.userAddress}`);
      localStorage.removeItem(`blockstar-key-sig-${this.userAddress}`);
    }
    this.destroy();
  }
}

export const encryptionService = new EncryptionService();
