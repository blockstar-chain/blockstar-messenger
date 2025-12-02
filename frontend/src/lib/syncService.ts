// frontend/src/lib/syncService.ts
// BlockStar Cypher - Data Sync Service
// Fetches data from MongoDB backend via API
// Messages are stored ENCRYPTED on server, decrypted locally

import { db, dbHelpers } from './database';
import { encryptionService } from './encryption';
import { Message, Conversation } from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

export interface SyncResult {
  success: boolean;
  conversationsCount: number;
  messagesCount: number;
  syncedAt: number;
  error?: string;
}

/**
 * Sync all data from server for a user
 * Call this on app startup and after cache clear
 * Messages are ENCRYPTED on server - we decrypt them here
 */
export async function syncFromServer(walletAddress: string): Promise<SyncResult> {
  try {
    console.log('🔄 Starting sync from server...');
    
    const response = await fetch(`${API_BASE}/api/sync/${walletAddress}`);
    
    if (!response.ok) {
      throw new Error(`Sync failed: HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Sync failed');
    }
    
    let messagesCount = 0;
    const normalizedWallet = walletAddress.toLowerCase();
    
    // Process each conversation
    for (const serverConv of data.conversations) {
      // Save/update conversation
      const conversation: Conversation = {
        id: serverConv.id,
        type: serverConv.type,
        participants: serverConv.participants,
        name: serverConv.name,
        unreadCount: 0,
        createdAt: serverConv.createdAt,
        updatedAt: serverConv.updatedAt,
      };
      
      // Process and decrypt messages
      if (serverConv.messages && serverConv.messages.length > 0) {
        for (const serverMsg of serverConv.messages) {
          const recipientAddr = serverConv.participants.find((p: string) => p !== serverMsg.senderWallet) || '';
          
          // Decrypt the message
          // Use the other party's public key to derive shared secret
          let decryptedContent = serverMsg.content;
          const isSentByUs = serverMsg.senderWallet.toLowerCase() === normalizedWallet;
          
          if (encryptionService.isReady()) {
            try {
              const otherParty = isSentByUs ? recipientAddr : serverMsg.senderWallet;
              const { decrypted, wasEncrypted } = await encryptionService.decryptFromSender(
                serverMsg.content,
                otherParty
              );
              if (wasEncrypted) {
                decryptedContent = decrypted;
              }
            } catch (decryptError) {
              console.warn('Could not decrypt message during sync:', decryptError);
              // Keep original content if decryption fails
            }
          }
          
          const message: Message = {
            id: serverMsg.id,
            conversationId: serverMsg.conversationId || serverConv.id,
            senderId: serverMsg.senderWallet,
            recipientId: recipientAddr,
            content: decryptedContent, // Store decrypted content locally
            timestamp: serverMsg.timestamp,
            type: serverMsg.type || 'text',
            delivered: serverMsg.delivered,
            read: serverMsg.readBy?.includes(normalizedWallet) || false,
          };
          
          await dbHelpers.saveMessage(message);
          messagesCount++;
        }
        
        // Set last message (decrypted) for conversation
        const lastServerMsg = serverConv.messages[serverConv.messages.length - 1];
        const lastRecipient = serverConv.participants.find((p: string) => p !== lastServerMsg.senderWallet) || '';
        
        // Decrypt last message for preview
        let lastMsgContent = lastServerMsg.content;
        const lastMsgSentByUs = lastServerMsg.senderWallet.toLowerCase() === normalizedWallet;
        
        if (encryptionService.isReady()) {
          try {
            const otherParty = lastMsgSentByUs ? lastRecipient : lastServerMsg.senderWallet;
            const { decrypted, wasEncrypted } = await encryptionService.decryptFromSender(
              lastServerMsg.content,
              otherParty
            );
            if (wasEncrypted) {
              lastMsgContent = decrypted;
            }
          } catch {
            // Keep original if decryption fails
          }
        }
        
        conversation.lastMessage = {
          id: lastServerMsg.id,
          conversationId: lastServerMsg.conversationId,
          senderId: lastServerMsg.senderWallet,
          recipientId: lastRecipient,
          content: lastMsgContent,
          timestamp: lastServerMsg.timestamp,
          type: lastServerMsg.type || 'text',
          delivered: lastServerMsg.delivered,
          read: lastServerMsg.readBy?.includes(normalizedWallet) || false,
        };
      }
      
      // Save conversation to local cache so it's available in db.conversations.toArray()
      await db.conversations.put(conversation);
    }
    
    console.log(`✅ Sync complete: ${data.conversations.length} conversations, ${messagesCount} messages (decrypted)`);
    
    return {
      success: true,
      conversationsCount: data.conversations.length,
      messagesCount,
      syncedAt: data.syncedAt,
    };
    
  } catch (error) {
    console.error('❌ Sync failed:', error);
    return {
      success: false,
      conversationsCount: 0,
      messagesCount: 0,
      syncedAt: Date.now(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Fetch conversations from server
 */
export async function fetchConversations(walletAddress: string): Promise<Conversation[]> {
  try {
    const response = await fetch(`${API_BASE}/api/conversations/${walletAddress}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch conversations');
    }
    
    const conversations: Conversation[] = data.conversations.map((serverConv: any) => ({
      id: serverConv.id,
      type: serverConv.type,
      participants: serverConv.participants,
      name: serverConv.name,
      unreadCount: 0,
      createdAt: serverConv.createdAt,
      updatedAt: serverConv.updatedAt,
      lastMessage: serverConv.lastMessage ? {
        id: serverConv.lastMessage.id,
        conversationId: serverConv.id,
        senderId: serverConv.lastMessage.senderWallet,
        recipientId: serverConv.participants.find((p: string) => p !== serverConv.lastMessage.senderWallet) || '',
        content: serverConv.lastMessage.content,
        timestamp: serverConv.lastMessage.timestamp,
        type: serverConv.lastMessage.type || 'text',
        delivered: true,
        read: false,
      } : undefined,
    }));
    
    // Data comes from API - no local storage needed
    
    return conversations;
    
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return [];
  }
}

/**
 * Fetch messages for a conversation from server
 */
export async function fetchMessages(
  conversationId: string, 
  limit: number = 50, 
  before?: number
): Promise<Message[]> {
  try {
    let url = `${API_BASE}/api/conversations/${conversationId}/messages?limit=${limit}`;
    if (before) {
      url += `&before=${before}`;
    }
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch messages');
    }
    
    const messages: Message[] = data.messages.map((serverMsg: any) => ({
      id: serverMsg.id,
      conversationId: serverMsg.conversationId || conversationId,
      senderId: (serverMsg.senderWallet || '').toLowerCase(),
      recipientId: (serverMsg.recipientWallet || '').toLowerCase(),
      content: serverMsg.content,
      timestamp: serverMsg.timestamp,
      type: serverMsg.type || 'text',
      delivered: serverMsg.delivered,
      read: false,
    }));
    
    // Cache messages locally
    for (const msg of messages) {
      await dbHelpers.saveMessage(msg);
    }
    
    return messages;
    
  } catch (error) {
    console.error('Error fetching messages:', error);
    return [];
  }
}

/**
 * Get or create a direct conversation on the server
 */
export async function getOrCreateConversation(
  user1: string, 
  user2: string
): Promise<{ id: string; conversation: Conversation } | null> {
  try {
    const response = await fetch(`${API_BASE}/api/conversations/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user1, user2 }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to create conversation');
    }
    
    const conversation: Conversation = {
      id: data.conversation.id,
      type: data.conversation.type,
      participants: data.conversation.participants,
      unreadCount: 0,
      createdAt: data.conversation.createdAt,
      updatedAt: data.conversation.updatedAt,
    };
    
    // Data comes from server - no local storage needed
    
    return { id: data.conversation.id, conversation };
    
  } catch (error) {
    console.error('Error creating conversation:', error);
    return null;
  }
}

/**
 * Save a message via REST API (backup for WebSocket)
 */
export async function saveMessageToServer(
  conversationId: string,
  senderWallet: string,
  content: string,
  messageType: string = 'text'
): Promise<{ id: string } | null> {
  try {
    const response = await fetch(`${API_BASE}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        senderWallet,
        content,
        messageType,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to save message');
    }
    
    return { id: data.message.id };
    
  } catch (error) {
    console.error('Error saving message to server:', error);
    return null;
  }
}

/**
 * Check if we need to sync (based on last sync time)
 */
export function needsSync(lastSyncTime: number | null, maxAge: number = 5 * 60 * 1000): boolean {
  if (!lastSyncTime) return true;
  return Date.now() - lastSyncTime > maxAge;
}

/**
 * Clear local data and resync from server
 */
export async function clearAndResync(walletAddress: string): Promise<SyncResult> {
  try {
    console.log('🗑️ Clearing local cache...');
    
    // Clear local message cache
    dbHelpers.clearMessageCache();
    
    console.log('🔄 Resyncing from server...');
    
    // Resync from server
    return await syncFromServer(walletAddress);
    
  } catch (error) {
    console.error('Error during clear and resync:', error);
    return {
      success: false,
      conversationsCount: 0,
      messagesCount: 0,
      syncedAt: Date.now(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default {
  syncFromServer,
  fetchConversations,
  fetchMessages,
  getOrCreateConversation,
  saveMessageToServer,
  needsSync,
  clearAndResync,
};
