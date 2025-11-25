import Dexie, { Table } from 'dexie';
import { Message, Conversation, User, SignalKeys } from '@/types';

export class MessengerDatabase extends Dexie {
  messages!: Table<Message, string>;
  conversations!: Table<Conversation, string>;
  users!: Table<User, string>;
  signalKeys!: Table<SignalKeys & { address: string }, string>;

  constructor() {
    super('BlockStarMessenger');
    
    this.version(1).stores({
      messages: 'id, conversationId, senderId, recipientId, timestamp, delivered, read',
      conversations: 'id, *participants, updatedAt',
      users: 'walletAddress, username',
      signalKeys: 'address',
    });
  }
}

export const db = new MessengerDatabase();

// Helper functions for database operations
export const dbHelpers = {
  async saveMessage(message: Message): Promise<void> {
    // Use put instead of add to handle duplicates
    await db.messages.put(message);
    
    // Update conversation
    const conversationId = message.conversationId;
    const conversation = await db.conversations.get(conversationId);
    
    if (conversation) {
      await db.conversations.update(conversationId, {
        lastMessage: message,
        updatedAt: Date.now(),
      });
    } else {
      // Determine if it's a group based on recipientId
      const isGroup = Array.isArray(message.recipientId);
      const participants = isGroup 
        ? [message.senderId, ...(message.recipientId as string[])]
        : [message.senderId, message.recipientId as string];
      
      // Use put for conversations too
      await db.conversations.put({
        id: conversationId,
        type: isGroup ? 'group' : 'direct',
        participants,
        lastMessage: message,
        unreadCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  },

  async getConversationMessages(conversationId: string): Promise<Message[]> {
    return await db.messages
      .where('conversationId')
      .equals(conversationId)
      .sortBy('timestamp');
  },

  async markMessageAsRead(messageId: string): Promise<void> {
    await db.messages.update(messageId, { read: true });
  },

  async getUser(walletAddress: string): Promise<User | undefined> {
    return await db.users.get(walletAddress);
  },

  async saveUser(user: User): Promise<void> {
    await db.users.put(user);
  },

  async saveSignalKeys(address: string, keys: SignalKeys): Promise<void> {
    await db.signalKeys.put({ address, ...keys });
  },

  async getSignalKeys(address: string): Promise<SignalKeys | undefined> {
    const record = await db.signalKeys.get(address);
    if (!record) return undefined;
    
    const { address: _, ...keys } = record;
    return keys as SignalKeys;
  },
};
