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
let contactsCollection: Collection;
let pushTokensCollection: Collection;

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
    contactsCollection = db.collection('contacts');
    pushTokensCollection = db.collection('push_tokens');
    
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
    
    // Contacts indexes
    await contactsCollection.createIndex({ owner_wallet: 1, contact_wallet: 1 }, { unique: true });
    await contactsCollection.createIndex({ owner_wallet: 1 });
    
    // Push tokens indexes
    await pushTokensCollection.createIndex({ wallet_address: 1 });
    await pushTokensCollection.createIndex({ wallet_address: 1, push_token: 1 }, { unique: true });
    
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
  // First try to find by group_id (for groups)
  let conv = await conversationsCollection.findOne({ 
    group_id: conversationId 
  });
  
  // If not found, try by ObjectId
  if (!conv) {
    try {
      conv = await conversationsCollection.findOne({ 
        _id: new ObjectId(conversationId) 
      });
    } catch {
      // Invalid ObjectId format, that's ok
    }
  }
  
  return conv as DBConversation | null;
}

export async function getUserConversations(walletAddress: string): Promise<DBConversation[]> {
  const normalizedAddress = walletAddress.toLowerCase();
  
  // Get conversations where user is a participant AND not hidden for this user
  const conversations = await conversationsCollection.find({
    participants: normalizedAddress,
    $or: [
      { hidden_for: { $exists: false } },
      { hidden_for: { $nin: [normalizedAddress] } }
    ]
  }).sort({ updated_at: -1 }).toArray();
  
  return conversations as DBConversation[];
}

export async function createGroupConversation(group: any): Promise<string> {
  const now = new Date();
  
  // Use the frontend-provided group ID
  const groupId = group.id;
  
  // Group name should ALWAYS be provided - if not, something is wrong
  if (!group.groupName && !group.name) {
    console.error('⚠️ WARNING: createGroupConversation called without group name! This should not happen.');
    console.error('Group data:', JSON.stringify(group, null, 2));
  }
  
  const groupName = group.groupName || group.name;
  
  if (!groupName) {
    throw new Error('Cannot create group without a name');
  }
  
  console.log(`📝 createGroupConversation called with:`, {
    id: groupId,
    groupName: group.groupName,
    name: group.name,
    resolvedName: groupName
  });
  
  // Check if group already exists by the group_id
  let existing = await conversationsCollection.findOne({
    type: 'group',
    group_id: groupId
  });
  
  if (existing) {
    console.log('Group conversation already exists by group_id:', groupId);
    return groupId;
  }
  
  // Normalize participants to lowercase
  const participants = (group.participants || []).map((p: string) => p.toLowerCase());
  
  // Also check if a group with same participants exists (to prevent duplicates)
  const sortedParticipants = [...participants].sort();
  existing = await conversationsCollection.findOne({
    type: 'group',
    participants: { $all: sortedParticipants, $size: sortedParticipants.length }
  });
  
  if (existing) {
    const existingAny = existing as any;
    console.log('Group conversation already exists by participants, updating group_id:', existingAny.group_id || existing._id);
    
    // Update the existing group with the new group_id if it doesn't have one
    if (!existingAny.group_id) {
      await conversationsCollection.updateOne(
        { _id: existing._id },
        { $set: { group_id: groupId, name: groupName, updated_at: now } }
      );
      console.log('Updated existing group with new group_id:', groupId);
    }
    
    return existingAny.group_id || existing._id!.toString();
  }
  
  // Create new group conversation - use frontend ID as group_id
  await conversationsCollection.insertOne({
    type: 'group',
    group_id: groupId,  // Store the frontend-generated ID
    participants,
    name: groupName,  // Use resolved name
    avatar_url: group.groupAvatar || group.avatar,
    created_by: (group.createdBy || '').toLowerCase(),
    admins: (group.admins || []).map((a: string) => a.toLowerCase()),
    created_at: now,
    updated_at: now,
  });
  
  console.log(`✅ Created group "${groupName}" with ID:`, groupId);
  return groupId;
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
  reactions?: Array<{ emoji: string; userId: string; timestamp: number }>;
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
  clientId?: string,  // Client-generated message ID
  encryptedPayloads?: Record<string, string>  // Per-recipient encrypted content for groups
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
  
  // Store encrypted payloads for group messages
  if (encryptedPayloads) {
    (message as any).encrypted_payloads = encryptedPayloads;
  }
  
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

export async function toggleMessageReaction(
  messageId: string,
  emoji: string,
  userId: string
): Promise<{ action: 'add' | 'remove'; reactions: Array<{ emoji: string; userId: string; timestamp: number }> }> {
  const normalizedUserId = userId.toLowerCase();
  
  // Try to find message by client_id first
  let message = await messagesCollection.findOne({ 
    client_id: messageId 
  }) as DBMessage | null;
  
  // Fallback: try as MongoDB ObjectId
  if (!message) {
    try {
      message = await messagesCollection.findOne({ 
        _id: new ObjectId(messageId) 
      }) as DBMessage | null;
    } catch {}
  }
  
  if (!message) {
    console.log('Message not found for reaction:', messageId);
    return { action: 'add', reactions: [] };
  }
  
  const currentReactions = message.reactions || [];
  const existingIndex = currentReactions.findIndex(
    r => r.emoji === emoji && r.userId === normalizedUserId
  );
  
  let action: 'add' | 'remove';
  let newReactions: Array<{ emoji: string; userId: string; timestamp: number }>;
  
  if (existingIndex >= 0) {
    // Remove reaction
    action = 'remove';
    newReactions = currentReactions.filter((_, i) => i !== existingIndex);
  } else {
    // Add reaction
    action = 'add';
    newReactions = [...currentReactions, { emoji, userId: normalizedUserId, timestamp: Date.now() }];
  }
  
  // Update in database
  const query = message.client_id 
    ? { client_id: messageId }
    : { _id: message._id };
    
  await messagesCollection.updateOne(
    query,
    { $set: { reactions: newReactions, updated_at: new Date() } }
  );
  
  console.log(`💬 Reaction ${action}: ${emoji} by ${normalizedUserId} on message ${messageId}`);
  
  return { action, reactions: newReactions };
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
  conversation_id?: string;  // For group messages
  group_info?: {  // Group metadata for creating group on delivery
    id: string;
    groupName: string;
    participants: string[];
    admins?: string[];
    createdBy?: string;
  };
  created_at: Date;
}

export async function queueOfflineMessage(
  recipientWallet: string,
  senderWallet: string,
  content: string,
  messageType: string = 'text',
  clientId?: string,
  conversationId?: string,
  groupInfo?: any
): Promise<void> {
  await offlineMessagesCollection.insertOne({
    recipient_wallet: recipientWallet.toLowerCase(),
    sender_wallet: senderWallet.toLowerCase(),
    content,
    message_type: messageType,
    client_id: clientId,
    conversation_id: conversationId,
    group_info: groupInfo,
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
// GROUP MANAGEMENT OPERATIONS
// ============================================

export async function addGroupMember(
  conversationId: string,
  memberWallet: string,
  adminWallet: string
): Promise<boolean> {
  const normalizedMember = memberWallet.toLowerCase();
  const normalizedAdmin = adminWallet.toLowerCase();
  
  // Get the conversation first
  let conversation;
  try {
    conversation = await conversationsCollection.findOne({ 
      _id: new ObjectId(conversationId) 
    });
  } catch {
    // Try by group_id if ObjectId fails
    conversation = await conversationsCollection.findOne({ 
      group_id: conversationId 
    });
  }
  
  if (!conversation) {
    console.error('Group not found:', conversationId);
    return false;
  }
  
  // Check if requester is admin - normalize all addresses for comparison
  const admins = (conversation.admins || []).map((a: string) => a.toLowerCase());
  const createdBy = (conversation.created_by || '').toLowerCase();
  const isAdmin = admins.includes(normalizedAdmin) || createdBy === normalizedAdmin;
  
  console.log('addGroupMember check:', { normalizedAdmin, admins, createdBy, isAdmin });
  
  if (!isAdmin) {
    console.error('User is not admin:', normalizedAdmin);
    return false;
  }
  
  // Check if member already in group - normalize participants too
  const normalizedParticipants = conversation.participants.map((p: string) => p.toLowerCase());
  if (normalizedParticipants.includes(normalizedMember)) {
    console.log('Member already in group:', normalizedMember);
    return true;
  }
  
  // Add member
  await conversationsCollection.updateOne(
    { _id: conversation._id },
    { 
      $push: { participants: normalizedMember } as any,
      $set: { updated_at: new Date() }
    }
  );
  
  console.log(`Added ${normalizedMember} to group ${conversationId}`);
  return true;
}

export async function removeGroupMember(
  conversationId: string,
  memberWallet: string,
  adminWallet: string
): Promise<boolean> {
  const normalizedMember = memberWallet.toLowerCase();
  const normalizedAdmin = adminWallet.toLowerCase();
  
  // Get the conversation first
  let conversation;
  try {
    conversation = await conversationsCollection.findOne({ 
      _id: new ObjectId(conversationId) 
    });
  } catch {
    // Try by group_id if ObjectId fails
    conversation = await conversationsCollection.findOne({ 
      group_id: conversationId 
    });
  }
  
  if (!conversation) {
    console.error('Group not found:', conversationId);
    return false;
  }
  
  // Check if requester is admin (or removing themselves) - normalize all addresses
  const admins = (conversation.admins || []).map((a: string) => a.toLowerCase());
  const createdBy = (conversation.created_by || '').toLowerCase();
  const isAdmin = admins.includes(normalizedAdmin) || createdBy === normalizedAdmin;
  const isSelfRemoval = normalizedMember === normalizedAdmin;
  
  console.log('removeGroupMember check:', { normalizedAdmin, normalizedMember, admins, createdBy, isAdmin, isSelfRemoval });
  
  if (!isAdmin && !isSelfRemoval) {
    console.error('User is not authorized to remove members:', normalizedAdmin);
    return false;
  }
  
  // Can't remove the creator
  if (normalizedMember === createdBy) {
    console.error('Cannot remove group creator:', normalizedMember);
    return false;
  }
  
  // Remove member from participants and admins
  await conversationsCollection.updateOne(
    { _id: conversation._id },
    { 
      $pull: { 
        participants: normalizedMember,
        admins: normalizedMember 
      } as any,
      $set: { updated_at: new Date() }
    }
  );
  
  console.log(`Removed ${normalizedMember} from group ${conversationId}`);
  return true;
}

export async function addGroupAdmin(
  conversationId: string,
  memberWallet: string,
  adminWallet: string
): Promise<boolean> {
  const normalizedMember = memberWallet.toLowerCase();
  const normalizedAdmin = adminWallet.toLowerCase();
  
  // Get the conversation first
  let conversation;
  try {
    conversation = await conversationsCollection.findOne({ 
      _id: new ObjectId(conversationId) 
    });
  } catch {
    conversation = await conversationsCollection.findOne({ 
      group_id: conversationId 
    });
  }
  
  if (!conversation) {
    return false;
  }
  
  // Check if requester is admin - normalize all addresses
  const admins = (conversation.admins || []).map((a: string) => a.toLowerCase());
  const createdBy = (conversation.created_by || '').toLowerCase();
  const isAdmin = admins.includes(normalizedAdmin) || createdBy === normalizedAdmin;
  
  if (!isAdmin) {
    return false;
  }
  
  // Check if member is in the group - normalize participants
  const normalizedParticipants = conversation.participants.map((p: string) => p.toLowerCase());
  if (!normalizedParticipants.includes(normalizedMember)) {
    return false;
  }
  
  // Add as admin
  await conversationsCollection.updateOne(
    { _id: conversation._id },
    { 
      $addToSet: { admins: normalizedMember },
      $set: { updated_at: new Date() }
    }
  );
  
  return true;
}

export async function removeGroupAdmin(
  conversationId: string,
  memberWallet: string,
  adminWallet: string
): Promise<boolean> {
  const normalizedMember = memberWallet.toLowerCase();
  const normalizedAdmin = adminWallet.toLowerCase();
  
  // Get the conversation first
  let conversation;
  try {
    conversation = await conversationsCollection.findOne({ 
      _id: new ObjectId(conversationId) 
    });
  } catch {
    conversation = await conversationsCollection.findOne({ 
      group_id: conversationId 
    });
  }
  
  if (!conversation) {
    return false;
  }
  
  // Check if requester is admin - normalize all addresses
  const admins = (conversation.admins || []).map((a: string) => a.toLowerCase());
  const createdBy = (conversation.created_by || '').toLowerCase();
  const isAdmin = admins.includes(normalizedAdmin) || createdBy === normalizedAdmin;
  
  if (!isAdmin) {
    return false;
  }
  
  // Can't remove admin from creator
  if (normalizedMember === createdBy) {
    return false;
  }
  
  // Remove from admins
  await conversationsCollection.updateOne(
    { _id: conversation._id },
    { 
      $pull: { admins: normalizedMember } as any,
      $set: { updated_at: new Date() }
    }
  );
  
  return true;
}

/**
 * Get a group by ID
 */
export async function getGroup(conversationId: string): Promise<any | null> {
  let conversation;
  try {
    conversation = await conversationsCollection.findOne({ 
      _id: new ObjectId(conversationId) 
    });
  } catch {
    conversation = await conversationsCollection.findOne({ 
      group_id: conversationId 
    });
  }
  
  return conversation;
}

/**
 * Update group avatar
 */
export async function updateGroupAvatar(conversationId: string, avatarUrl: string): Promise<boolean> {
  let result;
  try {
    result = await conversationsCollection.updateOne(
      { _id: new ObjectId(conversationId) },
      { 
        $set: { 
          avatar_url: avatarUrl,
          updated_at: new Date()
        }
      }
    );
  } catch {
    result = await conversationsCollection.updateOne(
      { group_id: conversationId },
      { 
        $set: { 
          avatar_url: avatarUrl,
          updated_at: new Date()
        }
      }
    );
  }
  
  return result.modifiedCount > 0;
}

export async function getGroupMembers(conversationId: string): Promise<string[]> {
  let conversation;
  try {
    conversation = await conversationsCollection.findOne({ 
      _id: new ObjectId(conversationId) 
    });
  } catch {
    conversation = await conversationsCollection.findOne({ 
      group_id: conversationId 
    });
  }
  
  if (!conversation) {
    return [];
  }
  
  return conversation.participants || [];
}

// ============================================
// CONTACTS
// ============================================

interface Contact {
  id: string;
  owner_wallet: string;
  contact_wallet: string;
  nickname?: string;
  is_favorite: boolean;
  added_at: number;
  updated_at: number;
}

/**
 * Get all contacts for a user
 */
export async function getContacts(ownerWallet: string): Promise<Contact[]> {
  const normalizedWallet = ownerWallet.toLowerCase();
  
  const contacts = await contactsCollection
    .find({ owner_wallet: normalizedWallet })
    .sort({ is_favorite: -1, added_at: -1 })
    .toArray();
  
  return contacts.map(c => ({
    id: c._id.toString(),
    owner_wallet: c.owner_wallet,
    contact_wallet: c.contact_wallet,
    nickname: c.nickname,
    is_favorite: c.is_favorite || false,
    added_at: c.added_at,
    updated_at: c.updated_at,
  }));
}

/**
 * Add a new contact
 */
export async function addContact(
  ownerWallet: string,
  contactWallet: string,
  nickname?: string
): Promise<Contact | null> {
  const normalizedOwner = ownerWallet.toLowerCase();
  const normalizedContact = contactWallet.toLowerCase();
  
  // Don't allow adding self
  if (normalizedOwner === normalizedContact) {
    return null;
  }
  
  const now = Date.now();
  
  try {
    const result = await contactsCollection.insertOne({
      owner_wallet: normalizedOwner,
      contact_wallet: normalizedContact,
      nickname: nickname || undefined,
      is_favorite: false,
      added_at: now,
      updated_at: now,
    });
    
    return {
      id: result.insertedId.toString(),
      owner_wallet: normalizedOwner,
      contact_wallet: normalizedContact,
      nickname,
      is_favorite: false,
      added_at: now,
      updated_at: now,
    };
  } catch (error: any) {
    // Duplicate key error (contact already exists)
    if (error.code === 11000) {
      return null;
    }
    throw error;
  }
}

/**
 * Update a contact (nickname, favorite status)
 */
export async function updateContact(
  ownerWallet: string,
  contactWallet: string,
  updates: { nickname?: string; is_favorite?: boolean }
): Promise<boolean> {
  const normalizedOwner = ownerWallet.toLowerCase();
  const normalizedContact = contactWallet.toLowerCase();
  
  const updateFields: any = { updated_at: Date.now() };
  
  if (updates.nickname !== undefined) {
    updateFields.nickname = updates.nickname || null;
  }
  if (updates.is_favorite !== undefined) {
    updateFields.is_favorite = updates.is_favorite;
  }
  
  const result = await contactsCollection.updateOne(
    { owner_wallet: normalizedOwner, contact_wallet: normalizedContact },
    { $set: updateFields }
  );
  
  return result.modifiedCount > 0;
}

/**
 * Remove a contact
 */
export async function removeContact(
  ownerWallet: string,
  contactWallet: string
): Promise<boolean> {
  const normalizedOwner = ownerWallet.toLowerCase();
  const normalizedContact = contactWallet.toLowerCase();
  
  const result = await contactsCollection.deleteOne({
    owner_wallet: normalizedOwner,
    contact_wallet: normalizedContact,
  });
  
  return result.deletedCount > 0;
}

/**
 * Check if a contact exists
 */
export async function isContactExists(
  ownerWallet: string,
  contactWallet: string
): Promise<boolean> {
  const normalizedOwner = ownerWallet.toLowerCase();
  const normalizedContact = contactWallet.toLowerCase();
  
  const contact = await contactsCollection.findOne({
    owner_wallet: normalizedOwner,
    contact_wallet: normalizedContact,
  });
  
  return !!contact;
}

/**
 * Hide a conversation for a specific user (soft delete)
 * The conversation still exists but won't be returned for this user
 */
export async function hideConversationForUser(
  conversationId: string,
  walletAddress: string
): Promise<boolean> {
  const normalizedAddress = walletAddress.toLowerCase();
  
  try {
    // Add this user to the hidden_for array
    await conversationsCollection.updateOne(
      { _id: new ObjectId(conversationId) },
      { 
        $addToSet: { hidden_for: normalizedAddress },
        $set: { updated_at: new Date() }
      }
    );
    return true;
  } catch (error) {
    console.error('Error hiding conversation:', error);
    return false;
  }
}

/**
 * Check if a conversation is hidden for a user
 */
export async function isConversationHiddenForUser(
  conversationId: string,
  walletAddress: string
): Promise<boolean> {
  const normalizedAddress = walletAddress.toLowerCase();
  
  try {
    const conversation = await conversationsCollection.findOne({
      _id: new ObjectId(conversationId),
      hidden_for: normalizedAddress
    });
    return !!conversation;
  } catch (error) {
    return false;
  }
}

/**
 * Cleanup duplicate groups for a user
 * Keeps the group with the most recent update or the one with group_id set
 */
export async function cleanupDuplicateGroups(
  walletAddress: string
): Promise<{ removed: number; kept: number }> {
  const normalizedAddress = walletAddress.toLowerCase();
  
  // Get all groups the user is a participant in
  const groups = await conversationsCollection.find({
    type: 'group',
    participants: normalizedAddress
  }).toArray();
  
  // Group by participants (sorted)
  const groupsByParticipants = new Map<string, any[]>();
  
  for (const group of groups) {
    const participantsKey = group.participants.sort().join(',');
    if (!groupsByParticipants.has(participantsKey)) {
      groupsByParticipants.set(participantsKey, []);
    }
    groupsByParticipants.get(participantsKey)!.push(group);
  }
  
  let removed = 0;
  let kept = 0;
  
  // For each set of duplicates, keep the best one and remove the rest
  for (const [participantsKey, duplicates] of groupsByParticipants) {
    if (duplicates.length <= 1) {
      kept++;
      continue;
    }
    
    // Sort to find the best one to keep:
    // 1. Prefer ones with group_id set (frontend-generated)
    // 2. Prefer ones with a proper name (not null or "Group Chat")
    // 3. Prefer most recently updated
    duplicates.sort((a, b) => {
      // Prefer ones with group_id
      const aHasGroupId = !!a.group_id;
      const bHasGroupId = !!b.group_id;
      if (aHasGroupId && !bHasGroupId) return -1;
      if (!aHasGroupId && bHasGroupId) return 1;
      
      // Prefer ones with a proper name
      const aHasName = a.name && a.name !== 'Group Chat';
      const bHasName = b.name && b.name !== 'Group Chat';
      if (aHasName && !bHasName) return -1;
      if (!aHasName && bHasName) return 1;
      
      // Prefer most recently updated
      return (b.updated_at?.getTime() || 0) - (a.updated_at?.getTime() || 0);
    });
    
    // Keep the first one, delete the rest
    const [toKeep, ...toRemove] = duplicates;
    console.log(`🧹 Keeping group "${toKeep.name}" (${toKeep.group_id || toKeep._id}), removing ${toRemove.length} duplicates`);
    
    for (const dup of toRemove) {
      await conversationsCollection.deleteOne({ _id: dup._id });
      removed++;
    }
    kept++;
  }
  
  return { removed, kept };
}

// ============================================
// PUSH TOKEN OPERATIONS
// ============================================

interface PushToken {
  wallet_address: string;
  push_token: string;
  platform: 'ios' | 'android';
  device_id: string;
  updated_at: Date;
  created_at: Date;   // add this
}
/**
 * Save or update a push token for a user
 */
export async function savePushToken(tokenData: PushToken): Promise<boolean> {
  const normalizedAddress = tokenData.wallet_address.toLowerCase();
  
  try {
    await pushTokensCollection.updateOne(
      { 
        wallet_address: normalizedAddress,
        push_token: tokenData.push_token 
      },
      {
        $set: {
          wallet_address: normalizedAddress,
          push_token: tokenData.push_token,
          platform: tokenData.platform,
          updated_at: tokenData.updated_at,
        }
      },
      { upsert: true }
    );
    return true;
  } catch (error) {
    console.error('Error saving push token:', error);
    return false;
  }
}

/**
 * Get all push tokens for a user
 */
export async function getPushTokens(walletAddress: string): Promise<PushToken[]> {
  const normalizedAddress = walletAddress.toLowerCase();
  
  const tokens = await pushTokensCollection.find({
    wallet_address: normalizedAddress
  }).toArray();
  
  return tokens as unknown as PushToken[];
}

/**
 * Delete a specific push token
 */
export async function deletePushToken(walletAddress: string, pushToken: string): Promise<boolean> {
  const normalizedAddress = walletAddress.toLowerCase();
  
  const result = await pushTokensCollection.deleteOne({
    wallet_address: normalizedAddress,
    push_token: pushToken
  });
  
  return result.deletedCount > 0;
}

/**
 * Delete all push tokens for a user
 */
export async function deleteAllPushTokens(walletAddress: string): Promise<number> {
  const normalizedAddress = walletAddress.toLowerCase();
  
  const result = await pushTokensCollection.deleteMany({
    wallet_address: normalizedAddress
  });
  
  return result.deletedCount;
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
  // Group management
  addGroupMember,
  removeGroupMember,
  addGroupAdmin,
  removeGroupAdmin,
  getGroupMembers,
  getGroup,
  updateGroupAvatar,
  // Message operations
  saveMessage,
  getMessages,
  getMessageById,
  markMessageDelivered,
  markMessagesRead,
  markSingleMessageRead,
  toggleMessageReaction,
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
  hideConversationForUser,
  isConversationHiddenForUser,
  cleanupDuplicateGroups,
  getUser,
  // Contact operations
  getContacts,
  addContact,
  updateContact,
  removeContact,
  isContactExists,
  // Push token operations
  savePushToken,
  getPushTokens,
  deletePushToken,
  deleteAllPushTokens,
};
