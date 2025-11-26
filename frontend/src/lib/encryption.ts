import { SignalKeys } from '@/types';
import { dbHelpers } from './database';

/**
 * Signal Protocol Encryption Service with Key Exchange
 * Implements end-to-end encryption using Web Crypto API
 */

// API base URL
const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

// Cache for public keys (in-memory)
const publicKeyCache = new Map<string, { key: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

export class EncryptionService {
  private keyPair: CryptoKeyPair | null = null;
  private userAddress: string | null = null;
  private publicKeyBase64: string | null = null;

  /**
   * Initialize encryption for a user
   */
  async initialize(walletAddress: string): Promise<void> {
    this.userAddress = walletAddress.toLowerCase();

    // Check if keys exist in database
    const existingKeys = await dbHelpers.getSignalKeys(this.userAddress);
    
    if (existingKeys) {
      // Import existing keys
      this.keyPair = await this.importKeyPair(existingKeys);
      this.publicKeyBase64 = await this.getPublicKey();
    } else {
      // Generate new key pair
      await this.generateKeyPair();
    }

    // Register public key with server
    await this.registerPublicKey();
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
        console.log('Public key registered successfully');
      }
    } catch (error) {
      console.error('Error registering public key:', error);
    }
  }

  /**
   * Fetch a user's public key from the server
   */
  async fetchPublicKey(walletAddress: string): Promise<string | null> {
    const address = walletAddress.toLowerCase();

    // Check cache first
    const cached = publicKeyCache.get(address);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.key;
    }

    try {
      const response = await fetch(`${API_URL}/api/keys/${address}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          console.warn(`No public key found for ${address}`);
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

      return null;
    } catch (error) {
      console.error('Error fetching public key:', error);
      return null;
    }
  }

  /**
   * Fetch multiple public keys at once
   */
  async fetchPublicKeys(addresses: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const uncached: string[] = [];

    // Check cache first
    for (const addr of addresses) {
      const address = addr.toLowerCase();
      const cached = publicKeyCache.get(address);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        results.set(address, cached.key);
      } else {
        uncached.push(address);
      }
    }

    // Fetch uncached keys from server
    if (uncached.length > 0) {
      try {
        const response = await fetch(`${API_URL}/api/keys/batch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ addresses: uncached }),
        });

        if (response.ok) {
          const data = await response.json();
          for (const [address, info] of Object.entries(data)) {
            const { publicKey } = info as any;
            if (publicKey) {
              results.set(address, publicKey);
              publicKeyCache.set(address, {
                key: publicKey,
                timestamp: Date.now(),
              });
            }
          }
        }
      } catch (error) {
        console.error('Error fetching public keys:', error);
      }
    }

    return results;
  }

  /**
   * Generate new encryption keys
   */
  private async generateKeyPair(): Promise<void> {
    // Generate ECDH key pair for encryption
    this.keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true, // extractable
      ['deriveKey', 'deriveBits']
    );

    // Export and save keys
    const publicKeyRaw = await crypto.subtle.exportKey('raw', this.keyPair.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', this.keyPair.privateKey);

    this.publicKeyBase64 = uint8ArrayToBase64(new Uint8Array(publicKeyRaw));

    const privateKeyString = JSON.stringify(privateKeyJwk);
    const privateKeyBytes = new TextEncoder().encode(privateKeyString);

    const signalKeys: SignalKeys = {
      identityKeyPair: {
        pubKey: new Uint8Array(publicKeyRaw),
        privKey: privateKeyBytes,
      },
      registrationId: Math.floor(Math.random() * 16383) + 1,
      preKeys: [],
      signedPreKey: {
        keyId: 1,
        keyPair: {
          pubKey: new Uint8Array(publicKeyRaw),
          privKey: privateKeyBytes,
        },
        signature: new Uint8Array(32),
      },
    };

    if (this.userAddress) {
      await dbHelpers.saveSignalKeys(this.userAddress, signalKeys);
    }
  }

  /**
   * Import existing key pair from database
   */
  private async importKeyPair(keys: SignalKeys): Promise<CryptoKeyPair> {
    const privateKeyString = new TextDecoder().decode(keys.identityKeyPair.privKey);
    const privateKeyJwk = JSON.parse(privateKeyString);

    const privateKey = await crypto.subtle.importKey(
      'jwk',
      privateKeyJwk,
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true,
      ['deriveKey', 'deriveBits']
    );

    const publicKey = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(keys.identityKeyPair.pubKey.buffer.slice(0)),
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true,
      []
    );

    return { publicKey, privateKey };
  }

  /**
   * Get public key for sharing with contacts
   */
  async getPublicKey(): Promise<string> {
    if (this.publicKeyBase64) {
      return this.publicKeyBase64;
    }

    if (!this.keyPair) {
      throw new Error('Encryption not initialized');
    }

    const publicKeyRaw = await crypto.subtle.exportKey('raw', this.keyPair.publicKey);
    this.publicKeyBase64 = uint8ArrayToBase64(new Uint8Array(publicKeyRaw));
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
  ): Promise<{ decrypted: string; wasEncrypted: boolean }> {
    // Check if message looks like base64 encrypted content
    const looksEncrypted = /^[A-Za-z0-9+/=]+$/.test(encryptedMessage) && 
                          encryptedMessage.length > 20;

    if (!looksEncrypted) {
      return { decrypted: encryptedMessage, wasEncrypted: false };
    }

    // Fetch sender's public key
    const senderPublicKey = await this.fetchPublicKey(senderAddress);
    
    if (!senderPublicKey) {
      // Can't decrypt without sender's key, return as-is
      return { decrypted: encryptedMessage, wasEncrypted: false };
    }

    try {
      const decrypted = await this.decryptMessage(encryptedMessage, senderPublicKey);
      return { decrypted, wasEncrypted: true };
    } catch (error) {
      // Decryption failed - might be plaintext
      return { decrypted: encryptedMessage, wasEncrypted: false };
    }
  }

  /**
   * Encrypt a message for a recipient
   */
  async encryptMessage(
    message: string,
    recipientPublicKey: string
  ): Promise<string> {
    if (!this.keyPair) {
      throw new Error('Encryption not initialized');
    }

    try {
      // Import recipient's public key
      const recipientKeyRaw = base64ToUint8Array(recipientPublicKey);
      const recipientKey = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(recipientKeyRaw.buffer.slice(0)),
        {
          name: 'ECDH',
          namedCurve: 'P-256',
        },
        false,
        []
      );

      // Derive shared secret
      const sharedSecret = await crypto.subtle.deriveKey(
        {
          name: 'ECDH',
          public: recipientKey,
        },
        this.keyPair.privateKey,
        {
          name: 'AES-GCM',
          length: 256,
        },
        false,
        ['encrypt']
      );

      // Generate IV
      const iv = crypto.getRandomValues(new Uint8Array(12));

      // Encrypt message
      const encoder = new TextEncoder();
      const encrypted = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        sharedSecret,
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
   * Decrypt a message from a sender
   */
  async decryptMessage(
    encryptedMessage: string,
    senderPublicKey: string
  ): Promise<string> {
    if (!this.keyPair) {
      throw new Error('Encryption not initialized');
    }

    try {
      // Import sender's public key
      const senderKeyRaw = base64ToUint8Array(senderPublicKey);
      const senderKey = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(senderKeyRaw.buffer.slice(0)),
        {
          name: 'ECDH',
          namedCurve: 'P-256',
        },
        false,
        []
      );

      // Derive shared secret
      const sharedSecret = await crypto.subtle.deriveKey(
        {
          name: 'ECDH',
          public: senderKey,
        },
        this.keyPair.privateKey,
        {
          name: 'AES-GCM',
          length: 256,
        },
        false,
        ['decrypt']
      );

      // Extract IV and encrypted data
      const combined = base64ToUint8Array(encryptedMessage);
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);

      // Decrypt message
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        sharedSecret,
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
   * Check if encryption is ready
   */
  isReady(): boolean {
    return this.keyPair !== null && this.userAddress !== null;
  }

  /**
   * Get user's address
   */
  getUserAddress(): string | null {
    return this.userAddress;
  }

  /**
   * Clean up encryption keys
   */
  destroy(): void {
    this.keyPair = null;
    this.userAddress = null;
    this.publicKeyBase64 = null;
  }
}

export const encryptionService = new EncryptionService();
