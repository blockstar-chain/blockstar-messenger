// frontend/src/lib/database.ts
// BlockStar Cypher - Database Service (NO Dexie/IndexedDB)
// All messages loaded from backend MongoDB via API
// Encryption keys stored in localStorage

import { Message, Conversation, User, SignalKeys } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

// Helper functions for Uint8Array <-> base64 conversion (needed for localStorage)
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

// In-memory cache for messages (cleared on page refresh)
const messageCache = new Map<string, Message[]>();
const conversationCache = new Map<string, Conversation>();

// Helper functions for API-based operations
export const dbHelpers = {
  // Messages are loaded from backend API, not stored locally
  async saveMessage(message: Message): Promise<void> {
    // Add to in-memory cache
    const conversationId = message.conversationId;
    const existing = messageCache.get(conversationId) || [];
    
    // Avoid duplicates - check by id
    const existingIndex = existing.findIndex(m => m.id === message.id);
    if (existingIndex >= 0) {
      // Update existing message
      existing[existingIndex] = message;
    } else {
      existing.push(message);
    }
    existing.sort((a, b) => a.timestamp - b.timestamp);
    messageCache.set(conversationId, existing);
    
    // Note: Actual persistence is handled by WebSocket/API when sending
  },

  async getConversationMessages(conversationId: string): Promise<Message[]> {
    // Return from cache if available
    if (messageCache.has(conversationId)) {
      return [...(messageCache.get(conversationId) || [])];
    }
    
    // Fetch from backend API
    try {
      const response = await fetch(`${API_URL}/api/conversations/${conversationId}/messages`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.messages) {
          const messages: Message[] = data.messages.map((msg: any) => ({
            id: msg.id || msg._id,
            conversationId: msg.conversationId || conversationId,
            senderId: (msg.senderWallet || msg.senderId || '').toLowerCase(),
            recipientId: (msg.recipientWallet || msg.recipientId || '').toLowerCase(),
            content: msg.content,
            timestamp: msg.timestamp || Date.now(),
            type: msg.type || msg.message_type || 'text',
            delivered: msg.delivered !== false,
            read: false, // Will be properly set by ChatArea based on readBy
            readBy: msg.readBy || [], // Include readBy for processing
          }));
          
          // Cache the messages
          messageCache.set(conversationId, messages);
          return messages;
        }
      }
    } catch (error) {
      console.warn('Failed to fetch messages from API:', error);
    }
    
    return [];
  },

  async markMessageAsRead(messageId: string, readerAddress?: string): Promise<void> {
    // Update local cache
    for (const [_convId, messages] of messageCache.entries()) {
      const msg = messages.find(m => m.id === messageId) as any;
      if (msg) {
        msg.read = true;
        // Also update readBy array if reader address provided
        if (readerAddress) {
          if (!msg.readBy) msg.readBy = [];
          const normalizedReader = readerAddress.toLowerCase();
          if (!msg.readBy.includes(normalizedReader)) {
            msg.readBy.push(normalizedReader);
          }
        }
        break;
      }
    }
  },

  async updateMessageRead(messageId: string, readerAddress?: string): Promise<void> {
    return this.markMessageAsRead(messageId, readerAddress);
  },

  async updateMessageDelivered(messageId: string): Promise<void> {
    for (const [_convId, messages] of messageCache.entries()) {
      const msg = messages.find(m => m.id === messageId);
      if (msg) {
        msg.delivered = true;
        break;
      }
    }
  },

  // User data - not storing locally
  async getUser(_walletAddress: string): Promise<User | undefined> {
    return undefined;
  },

  async saveUser(_user: User): Promise<void> {
    // Not storing locally - backend handles this
  },

  // Signal keys - store in localStorage (derived from wallet signature)
  // Uint8Array must be converted to base64 for JSON serialization
  async saveSignalKeys(address: string, keys: SignalKeys): Promise<void> {
    try {
      const storageKey = `blockstar_keys_${address.toLowerCase()}`;
      
      // Convert Uint8Array fields to base64 for JSON storage
      const serializable = {
        identityKeyPair: {
          pubKey: uint8ArrayToBase64(keys.identityKeyPair.pubKey),
          privKey: uint8ArrayToBase64(keys.identityKeyPair.privKey),
        },
        registrationId: keys.registrationId,
        preKeys: keys.preKeys,
        signedPreKey: {
          keyId: keys.signedPreKey.keyId,
          keyPair: {
            pubKey: uint8ArrayToBase64(keys.signedPreKey.keyPair.pubKey),
            privKey: uint8ArrayToBase64(keys.signedPreKey.keyPair.privKey),
          },
          signature: uint8ArrayToBase64(keys.signedPreKey.signature),
        },
      };
      
      localStorage.setItem(storageKey, JSON.stringify(serializable));
    } catch (e) {
      console.warn('Failed to save signal keys to localStorage:', e);
    }
  },

  async getSignalKeys(address: string): Promise<SignalKeys | undefined> {
    try {
      const storageKey = `blockstar_keys_${address.toLowerCase()}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        console.log('🔐 Found stored keys for', address);
        const parsed = JSON.parse(stored);
        
        // Validate key structure before conversion
        if (!parsed.identityKeyPair?.pubKey || !parsed.identityKeyPair?.privKey) {
          console.warn('Invalid key structure, missing required fields');
          localStorage.removeItem(storageKey);
          return undefined;
        }
        
        // Convert base64 strings back to Uint8Array
        const keys: SignalKeys = {
          identityKeyPair: {
            pubKey: base64ToUint8Array(parsed.identityKeyPair.pubKey),
            privKey: base64ToUint8Array(parsed.identityKeyPair.privKey),
          },
          registrationId: parsed.registrationId,
          preKeys: parsed.preKeys,
          signedPreKey: {
            keyId: parsed.signedPreKey.keyId,
            keyPair: {
              pubKey: base64ToUint8Array(parsed.signedPreKey.keyPair.pubKey),
              privKey: base64ToUint8Array(parsed.signedPreKey.keyPair.privKey),
            },
            signature: base64ToUint8Array(parsed.signedPreKey.signature),
          },
        };
        
        console.log('🔐 Successfully loaded keys, pubKey length:', keys.identityKeyPair.pubKey.length);
        return keys;
      }
      console.log('🔐 No stored keys found for', address);
    } catch (e) {
      console.warn('Failed to load signal keys from localStorage:', e);
      // Clear corrupted data
      try {
        const storageKey = `blockstar_keys_${address.toLowerCase()}`;
        localStorage.removeItem(storageKey);
        console.log('🔐 Cleared corrupted keys');
      } catch {}
    }
    return undefined;
  },
  
  // Helper to clear message cache for a conversation
  clearMessageCache(conversationId?: string): void {
    if (conversationId) {
      messageCache.delete(conversationId);
    } else {
      messageCache.clear();
    }
  },
  
  // Helper to add message to cache directly
  addMessageToCache(message: Message): void {
    const conversationId = message.conversationId;
    const existing = messageCache.get(conversationId) || [];
    
    // Avoid duplicates
    if (!existing.find(m => m.id === message.id)) {
      existing.push(message);
      existing.sort((a, b) => a.timestamp - b.timestamp);
      messageCache.set(conversationId, existing);
    }
  },
  
  // Get cached messages without API call
  getCachedMessages(conversationId: string): Message[] {
    return messageCache.get(conversationId) || [];
  },
  
  // Force refresh from API
  async refreshMessages(conversationId: string): Promise<Message[]> {
    messageCache.delete(conversationId);
    return this.getConversationMessages(conversationId);
  },
};

// Backwards-compatible db export for code that imports 'db' directly
export const db = {
  messages: {
    put: async (message: Message) => dbHelpers.saveMessage(message),
    get: async (id: string) => {
      for (const messages of messageCache.values()) {
        const msg = messages.find(m => m.id === id);
        if (msg) return msg;
      }
      return undefined;
    },
    update: async (id: string, updates: Partial<Message>) => {
      for (const messages of messageCache.values()) {
        const msg = messages.find(m => m.id === id);
        if (msg) {
          Object.assign(msg, updates);
          break;
        }
      }
    },
    where: (field: string) => ({
      equals: (value: string) => ({
        sortBy: async (_sortField: string) => {
          if (field === 'conversationId') {
            return messageCache.get(value) || [];
          }
          return [] as Message[];
        },
        delete: async () => {
          if (field === 'conversationId') {
            messageCache.delete(value);
          }
        },
        toArray: async () => {
          if (field === 'conversationId') {
            return messageCache.get(value) || [];
          }
          return [] as Message[];
        },
      }),
    }),
    clear: async () => messageCache.clear(),
    toArray: async () => {
      const allMessages: Message[] = [];
      for (const messages of messageCache.values()) {
        allMessages.push(...messages);
      }
      return allMessages;
    },
    delete: async (id: string) => {
      for (const [convId, messages] of messageCache.entries()) {
        const idx = messages.findIndex(m => m.id === id);
        if (idx >= 0) {
          messages.splice(idx, 1);
          break;
        }
      }
    },
  },
  conversations: {
    put: async (conversation: Conversation) => {
      conversationCache.set(conversation.id, conversation);
    },
    get: async (id: string) => conversationCache.get(id),
    update: async (id: string, updates: Partial<Conversation>) => {
      const conv = conversationCache.get(id);
      if (conv) {
        Object.assign(conv, updates);
      }
    },
    clear: async () => conversationCache.clear(),
    toArray: async () => Array.from(conversationCache.values()),
    delete: async (id: string) => conversationCache.delete(id),
    where: (field: string) => ({
      anyOf: (_values: string[]) => ({
        sortBy: async (_sortField: string) => [] as Conversation[],
        toArray: async () => [] as Conversation[],
      }),
      equals: (value: string) => ({
        toArray: async () => {
          const all = Array.from(conversationCache.values());
          return all.filter((c: any) => c[field] === value);
        },
      }),
    }),
  },
  users: {
    get: async (_id: string) => undefined as User | undefined,
    put: async (_user: User) => {},
    toArray: async () => [] as User[],
  },
  signalKeys: {
    get: async (address: string) => {
      const keys = await dbHelpers.getSignalKeys(address);
      return keys ? { address, ...keys } : undefined;
    },
    put: async (data: SignalKeys & { address: string }) => {
      const { address, ...keys } = data;
      await dbHelpers.saveSignalKeys(address, keys as SignalKeys);
    },
  },
};
