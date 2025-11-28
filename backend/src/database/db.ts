// backend/src/database/db.ts
// BlockStar Cypher - MongoDB Database Module
import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'blockstar_cypher';

let client: MongoClient;
let db: Db;

// Collections
let usersCollection: Collection;
let messagesCollection: Collection;
let conversationsCollection: Collection;
let offlineMessagesCollection: Collection;
let sessionsCollection: Collection;
let filesCollection: Collection;

// ============================================
// DATABASE CONNECTION
// ============================================

export async function initializeDatabase(): Promise<boolean> {
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    db = client.db(DB_NAME);
    
    // Initialize collections
    usersCollection = db.collection('users');
    messagesCollection = db.collection('messages');
    conversationsCollection = db.collection('conversations');
    offlineMessagesCollection = db.collection('offline_messages');
    sessionsCollection = db.collection('sessions');
    filesCollection = db.collection('files');
    
    // Create indexes for performance
    await createIndexes();
    
    console.log('📦 Connected to MongoDB:', DB_NAME);
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    return false;
  }
}

async function createIndexes(): Promise<void> {
  try {
    // Users indexes
    await usersCollection.createIndex({ wallet_address: 1 }, { unique: true });
    await usersCollection.createIndex({ username: 1 });
    
    // Messages indexes
    await messagesCollection.createIndex({ conversation_id: 1, created_at: -1 });
    await messagesCollection.createIndex({ sender_id: 1 });
    await messagesCollection.createIndex({ content: 'text' }); // Text search
    
    // Conversations indexes
    await conversationsCollection.createIndex({ participants: 1 });
    await conversationsCollection.createIndex({ updated_at: -1 });
    
    // Offline messages indexes
    await offlineMessagesCollection.createIndex({ recipient_wallet: 1 });
    await offlineMessagesCollection.createIndex({ created_at: 1 });
    
    // Sessions indexes
    await sessionsCollection.createIndex({ user_id: 1 });
    await sessionsCollection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }); // TTL index
    
    console.log('📦 MongoDB indexes created');
  } catch (error) {
    console.error('Error creating indexes:', error);
  }
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    console.log('📦 MongoDB connection closed');
  }
}

// ============================================
// USER OPERATIONS
// ============================================

export interface DBUser {
  _id?: ObjectId;
  wallet_address: string;
  username: string | null;
  public_key: string;
  status: string;
  last_seen: Date;
  created_at: Date;
  updated_at: Date;
}

export async function upsertUser(
  walletAddress: string, 
  publicKey: string, 
  username?: string
): Promise<DBUser> {
  const now = new Date();
  const wallet = walletAddress.toLowerCase();
  
  const result = await usersCollection.findOneAndUpdate(
    { wallet_address: wallet },
    {
      $set: {
        public_key: publicKey,
        username: username || null,
        status: 'online',
        last_seen: now,
        updated_at: now,
      },
      $setOnInsert: {
        wallet_address: wallet,
        created_at: now,
      }
    },
    { upsert: true, returnDocument: 'after' }
  );
  
  return result as unknown as DBUser;
}

export async function getUserByWallet(walletAddress: string): Promise<DBUser | null> {
  const user = await usersCollection.findOne({ 
    wallet_address: walletAddress.toLowerCase() 
  });
  return user as DBUser | null;
}

export async function getUsersByWallets(walletAddresses: string[]): Promise<DBUser[]> {
  const lowercased = walletAddresses.map(a => a.toLowerCase());
  const users = await usersCollection.find({ 
    wallet_address: { $in: lowercased } 
  }).toArray();
  return users as DBUser[];
}

export async function updateUserStatus(walletAddress: string, status: string): Promise<void> {
  await usersCollection.updateOne(
    { wallet_address: walletAddress.toLowerCase() },
    { 
      $set: { 
        status, 
        last_seen: new Date(),
        updated_at: new Date() 
      } 
    }
  );
}

export async function searchUsers(query: string, limit: number = 20): Promise<DBUser[]> {
  const regex = new RegExp(query, 'i');
  const users = await usersCollection.find({
    $or: [
      { username: regex },
      { wallet_address: regex }
    ]
  }).limit(limit).toArray();
  return users as DBUser[];
}

// ============================================
// CONVERSATION OPERATIONS
// ============================================

export interface DBConversation {
  _id?: ObjectId;
  type: 'direct' | 'group';
  participants: string[];
  name?: string;
  avatar_url?: string;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export async function getOrCreateDirectConversation(
  user1: string, 
  user2: string
): Promise<string> {
  const wallet1 = user1.toLowerCase();
  const wallet2 = user2.toLowerCase();
  const participants = [wallet1, wallet2].sort(); // Consistent ordering
  
  // Check if conversation exists
  const existing = await conversationsCollection.findOne({
    type: 'direct',
    participants: { $all: participants, $size: 2 }
  });
  
  if (existing) {
    return existing._id!.toString();
  }
  
  // Create new conversation
  const now = new Date();
  const result = await conversationsCollection.insertOne({
    type: 'direct',
    participants,
    created_at: now,
    updated_at: now,
  });
  
  return result.insertedId.toString();
}

export async function getConversationById(conversationId: string): Promise<DBConversation | null> {
  const conv = await conversationsCollection.findOne({ 
    _id: new ObjectId(conversationId) 
  });
  return conv as DBConversation | null;
}

export async function getUserConversations(walletAddress: string): Promise<DBConversation[]> {
  const conversations = await conversationsCollection.find({
    participants: walletAddress.toLowerCase()
  }).sort({ updated_at: -1 }).toArray();
  return conversations as DBConversation[];
}

export async function createGroupConversation(group: any): Promise<string> {
  const now = new Date();
  
  // Build query to check if group already exists
  const queryConditions: any[] = [{ group_id: group.id }];
  
  // Only add ObjectId check if we have a valid ObjectId string
  if (group.id && ObjectId.isValid(group.id)) {
    queryConditions.push({ _id: new ObjectId(group.id) });
  }
  
  // Check if group already exists
  const existing = await conversationsCollection.findOne({
    type: 'group',
    $or: queryConditions
  });
  
  if (existing) {
    console.log('Group conversation already exists:', existing._id);
    return existing._id!.toString();
  }
  
  // Normalize participants to lowercase
  const participants = (group.participants || []).map((p: string) => p.toLowerCase());
  
  // Create new group conversation
  const result = await conversationsCollection.insertOne({
    type: 'group',
    group_id: group.id,  // Store the frontend-generated ID for reference
    participants,
    name: group.groupName || group.name,
    avatar_url: group.groupAvatar || group.avatar,
    created_by: (group.createdBy || '').toLowerCase(),
    admins: (group.admins || []).map((a: string) => a.toLowerCase()),
    created_at: now,
    updated_at: now,
  });
  
  console.log('Created group conversation:', result.insertedId.toString());
  return result.insertedId.toString();
}

// ============================================
// MESSAGE OPERATIONS
// ============================================

export interface DBMessage {
  _id?: ObjectId;
  conversation_id: string;
  sender_wallet: string;
  content: string;
  message_type: string;
  delivered: boolean;
  read_by: string[];
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
  client_id?: string;  // Client-generated message ID for read receipt tracking
}

export async function saveMessage(
  conversationId: string,
  senderWallet: string,
  content: string | object,  // Accept both string and object
  messageType: string = 'text',
  clientId?: string  // Client-generated message ID
): Promise<DBMessage> {
  const now = new Date();
  
  // CRITICAL: Ensure content is always stored as a string
  // If content is an object, stringify it
  let contentString: string;
  if (typeof content === 'object' && content !== null) {
    contentString = JSON.stringify(content);
    console.log('⚠️ saveMessage received object content, stringified it');
  } else if (typeof content === 'string') {
    contentString = content;
  } else {
    contentString = String(content);
  }
  
  const message: DBMessage = {
    conversation_id: conversationId,
    sender_wallet: senderWallet.toLowerCase(),
    content: contentString,
    message_type: messageType,
    delivered: false,
    read_by: [],
    created_at: now,
    updated_at: now,
    client_id: clientId,
  };
  
  const result = await messagesCollection.insertOne(message);
  message._id = result.insertedId;
  
  // Update conversation timestamp
  await conversationsCollection.updateOne(
    { _id: new ObjectId(conversationId) },
    { $set: { updated_at: now } }
  );
  
  return message;
}

export async function getMessages(
  conversationId: string,
  limit: number = 50,
  before?: Date
): Promise<DBMessage[]> {
  const query: any = {
    conversation_id: conversationId,
    deleted_at: { $exists: false }
  };
  
  if (before) {
    query.created_at = { $lt: before };
  }
  
  const messages = await messagesCollection
    .find(query)
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  
  return messages.reverse() as DBMessage[]; // Return in chronological order
}

export async function markMessageDelivered(messageId: string): Promise<void> {
  await messagesCollection.updateOne(
    { _id: new ObjectId(messageId) },
    { $set: { delivered: true, updated_at: new Date() } }
  );
}

export async function markMessagesRead(
  conversationId: string, 
  walletAddress: string
): Promise<void> {
  await messagesCollection.updateMany(
    { 
      conversation_id: conversationId,
      read_by: { $ne: walletAddress.toLowerCase() }
    },
    { 
      $push: { read_by: walletAddress.toLowerCase() } as any,
      $set: { updated_at: new Date() }
    }
  );
}

export async function markSingleMessageRead(
  messageId: string,
  readerWallet: string
): Promise<{ senderId: string; conversationId: string } | null> {
  // Try to find message by client_id first (frontend-generated ID)
  let message = await messagesCollection.findOne({ 
    client_id: messageId 
  }) as DBMessage | null;
  
  // Fallback: try as MongoDB ObjectId (for backward compatibility)
  if (!message) {
    try {
      message = await messagesCollection.findOne({ 
        _id: new ObjectId(messageId) 
      }) as DBMessage | null;
    } catch (e) {
      // Not a valid ObjectId, that's fine
    }
  }
  
  if (!message) {
    console.log('Message not found for read receipt:', messageId);
    return null;
  }
  
  // Update the message
  await messagesCollection.updateOne(
    { _id: message._id },
    { 
      $addToSet: { read_by: readerWallet.toLowerCase() },
      $set: { updated_at: new Date() }
    }
  );
  
  console.log(`Message ${messageId} marked as read by ${readerWallet}`);
  
  return {
    senderId: message.sender_wallet,
    conversationId: message.conversation_id,
  };
}

export async function getMessageById(
  messageId: string
): Promise<{ senderId: string; conversationId: string; content: string } | null> {
  try {
    const message = await messagesCollection.findOne({ 
      _id: new ObjectId(messageId) 
    }) as DBMessage | null;
    
    if (!message) return null;
    
    return {
      senderId: message.sender_wallet,
      conversationId: message.conversation_id,
      content: message.content,
    };
  } catch (error) {
    // Handle case where messageId is not a valid ObjectId
    // (e.g., client-generated IDs)
    console.warn('Could not find message by ObjectId:', messageId);
    return null;
  }
}

export async function searchMessages(
  walletAddress: string,
  searchQuery: string,
  limit: number = 50
): Promise<DBMessage[]> {
  // Get user's conversations first
  const conversations = await getUserConversations(walletAddress);
  const conversationIds = conversations.map(c => c._id!.toString());
  
  const messages = await messagesCollection
    .find({
      conversation_id: { $in: conversationIds },
      $text: { $search: searchQuery },
      deleted_at: { $exists: false }
    })
    .limit(limit)
    .toArray();
  
  return messages as DBMessage[];
}

// ============================================
// OFFLINE MESSAGE QUEUE
// ============================================

export interface DBOfflineMessage {
  _id?: ObjectId;
  recipient_wallet: string;
  sender_wallet: string;
  content: string;
  message_type: string;
  client_id?: string;  // Client-generated message ID for read receipt tracking
  created_at: Date;
}

export async function queueOfflineMessage(
  recipientWallet: string,
  senderWallet: string,
  content: string,
  messageType: string = 'text',
  clientId?: string  // Client-generated message ID for read receipt tracking
): Promise<void> {
  await offlineMessagesCollection.insertOne({
    recipient_wallet: recipientWallet.toLowerCase(),
    sender_wallet: senderWallet.toLowerCase(),
    content,
    message_type: messageType,
    client_id: clientId,  // Store for later delivery
    created_at: new Date(),
  });
}

export async function getOfflineMessages(recipientWallet: string): Promise<DBOfflineMessage[]> {
  const messages = await offlineMessagesCollection
    .find({ recipient_wallet: recipientWallet.toLowerCase() })
    .sort({ created_at: 1 })
    .toArray();
  return messages as DBOfflineMessage[];
}

export async function clearOfflineMessages(recipientWallet: string): Promise<void> {
  await offlineMessagesCollection.deleteMany({ 
    recipient_wallet: recipientWallet.toLowerCase() 
  });
}

// ============================================
// SESSION MANAGEMENT
// ============================================

export interface DBSession {
  _id?: ObjectId;
  user_id: string;
  socket_id: string;
  device_info?: any;
  ip_address?: string;
  created_at: Date;
  expires_at: Date;
}

export async function createSession(
  walletAddress: string,
  socketId: string,
  deviceInfo?: any,
  ipAddress?: string
): Promise<string> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  
  const result = await sessionsCollection.insertOne({
    user_id: walletAddress.toLowerCase(),
    socket_id: socketId,
    device_info: deviceInfo || {},
    ip_address: ipAddress,
    created_at: new Date(),
    expires_at: expiresAt,
  });
  
  return result.insertedId.toString();
}

export async function deleteSession(socketId: string): Promise<void> {
  await sessionsCollection.deleteOne({ socket_id: socketId });
}

export async function deleteUserSessions(walletAddress: string): Promise<void> {
  await sessionsCollection.deleteMany({ 
    user_id: walletAddress.toLowerCase() 
  });
}

// ============================================
// FILE OPERATIONS
// ============================================

export interface DBFile {
  _id?: ObjectId;
  user_id: string;
  filename: string;
  original_filename: string;
  mimetype: string;
  size: number;
  storage_path: string;
  uploaded_at: Date;
}

export async function saveFileRecord(
  walletAddress: string,
  filename: string,
  originalFilename: string,
  mimetype: string,
  size: number,
  storagePath: string
): Promise<string> {
  const result = await filesCollection.insertOne({
    user_id: walletAddress.toLowerCase(),
    filename,
    original_filename: originalFilename,
    mimetype,
    size,
    storage_path: storagePath,
    uploaded_at: new Date(),
  });
  
  return result.insertedId.toString();
}

export async function getFileById(fileId: string): Promise<DBFile | null> {
  const file = await filesCollection.findOne({ _id: new ObjectId(fileId) });
  return file as DBFile | null;
}

// ============================================
// DELETE OPERATIONS
// ============================================

export async function deleteConversation(conversationId: string): Promise<void> {
  try {
    // Try to delete by ObjectId first, then by string id
    try {
      await conversationsCollection.deleteOne({ _id: new ObjectId(conversationId) });
    } catch {
      await conversationsCollection.deleteOne({ _id: conversationId } as any);
    }
  } catch (error) {
    console.error('Error deleting conversation:', error);
    throw error;
  }
}

export async function deleteConversationMessages(conversationId: string): Promise<void> {
  try {
    await messagesCollection.deleteMany({ conversation_id: conversationId });
  } catch (error) {
    console.error('Error deleting conversation messages:', error);
    throw error;
  }
}

export async function getUser(walletAddress: string): Promise<any> {
  return getUserByWallet(walletAddress);
}

export async function softDeleteMessage(messageId: string): Promise<boolean> {
  try {
    const result = await messagesCollection.updateOne(
      { _id: new ObjectId(messageId) },
      { $set: { deleted_at: new Date(), updated_at: new Date() } }
    );
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Error soft deleting message:', error);
    return false;
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

export async function getStats(): Promise<any> {
  const [userCount, messageCount, conversationCount] = await Promise.all([
    usersCollection.countDocuments(),
    messagesCollection.countDocuments(),
    conversationsCollection.countDocuments(),
  ]);
  
  return {
    users: userCount,
    messages: messageCount,
    conversations: conversationCount,
  };
}

// ============================================
// EXPORTS
// ============================================

export default {
  initializeDatabase,
  closeDatabase,
  getStats,
  // User operations
  upsertUser,
  getUserByWallet,
  getUsersByWallets,
  updateUserStatus,
  searchUsers,
  // Conversation operations
  getOrCreateDirectConversation,
  getConversationById,
  getUserConversations,
  createGroupConversation,
  // Message operations
  saveMessage,
  getMessages,
  getMessageById,
  markMessageDelivered,
  markMessagesRead,
  markSingleMessageRead,
  searchMessages,
  // Offline messages
  queueOfflineMessage,
  getOfflineMessages,
  clearOfflineMessages,
  // Session management
  createSession,
  deleteSession,
  deleteUserSessions,
  // File operations
  saveFileRecord,
  getFileById,
  // Delete operations
  deleteConversation,
  deleteConversationMessages,
  softDeleteMessage,
  getUser,
};
