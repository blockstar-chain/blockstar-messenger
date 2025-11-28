import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from './database/db';
import profileResolver from './services/profileResolver';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Create uploads directory
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueId = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueId}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    // Allow common file types
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm',
      'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  },
});

// Serve uploaded files with proper CORS and content-type headers
app.use('/uploads', (req, res, next) => {
  // Set CORS headers for media files
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  // Set appropriate content types for audio files
  const ext = path.extname(req.path).toLowerCase();
  if (ext === '.webm') {
    res.setHeader('Content-Type', 'audio/webm');
  } else if (ext === '.ogg') {
    res.setHeader('Content-Type', 'audio/ogg');
  } else if (ext === '.mp3') {
    res.setHeader('Content-Type', 'audio/mpeg');
  } else if (ext === '.mp4' || ext === '.m4a') {
    res.setHeader('Content-Type', 'audio/mp4');
  } else if (ext === '.wav') {
    res.setHeader('Content-Type', 'audio/wav');
  }

  // Enable range requests for audio/video seeking
  res.setHeader('Accept-Ranges', 'bytes');

  next();
}, express.static(uploadsDir));

// ============================================
// CONNECTION TRACKING (in-memory for real-time)
// User data and messages are stored in PostgreSQL
// ============================================

// Active WebSocket connections (real-time tracking only)
const activeConnections = new Map<string, string>(); // walletAddress -> socketId
const socketToWallet = new Map<string, string>(); // socketId -> walletAddress

// User statuses (cached in memory, backed by DB)
const userStatuses = new Map<string, string>(); // walletAddress -> status

// ============================================
// REST API ENDPOINTS
// ============================================

// Health check
app.get('/health', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json({
      status: 'ok',
      activeConnections: activeConnections.size,
      registeredUsers: stats.users,
      totalMessages: stats.messages,
      database: 'connected (MongoDB)',
      timestamp: Date.now(),
    });
  } catch (error) {
    res.json({
      status: 'ok',
      activeConnections: activeConnections.size,
      database: 'disconnected',
      timestamp: Date.now(),
    });
  }
});

// Register or update user's public key
app.post('/api/keys/register', async (req, res) => {
  try {
    const { walletAddress, publicKey, username } = req.body;

    if (!walletAddress || !publicKey) {
      return res.status(400).json({
        error: 'walletAddress and publicKey are required'
      });
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({
        error: 'Invalid wallet address format'
      });
    }

    // Save to database
    const user = await db.upsertUser(walletAddress, publicKey, username);

    console.log(`✅ Key registered for ${walletAddress} (DB ID: ${user._id})`);

    res.json({
      success: true,
      message: 'Public key registered successfully',
      registeredAt: user.created_at,
    });
  } catch (error) {
    console.error('Error registering key:', error);
    res.status(500).json({ error: 'Failed to register key' });
  }
});

// Get a user's public key
app.get('/api/keys/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const user = await db.getUserByWallet(walletAddress);

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        walletAddress
      });
    }

    res.json({
      walletAddress: user.wallet_address,
      publicKey: user.public_key,
      username: user.username,
      isOnline: activeConnections.has(walletAddress.toLowerCase()),
      status: userStatuses.get(walletAddress.toLowerCase()) || user.status || 'offline',
    });
  } catch (error) {
    console.error('Error fetching key:', error);
    res.status(500).json({ error: 'Failed to fetch key' });
  }
});

// Get multiple users' public keys
app.post('/api/keys/batch', async (req, res) => {
  try {
    const { addresses } = req.body;

    if (!Array.isArray(addresses)) {
      return res.status(400).json({ error: 'addresses must be an array' });
    }

    const users = await db.getUsersByWallets(addresses);
    const results: Record<string, any> = {};

    for (const user of users) {
      results[user.wallet_address] = {
        publicKey: user.public_key,
        username: user.username,
        isOnline: activeConnections.has(user.wallet_address),
        status: userStatuses.get(user.wallet_address) || user.status || 'offline',
      };
    }

    res.json(results);
  } catch (error) {
    console.error('Error fetching keys:', error);
    res.status(500).json({ error: 'Failed to fetch keys' });
  }
});

// Search users by username
app.get('/api/users/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Search query required' });
    }

    const users = await db.searchUsers(q, 20);

    const results = users.map((user: any) => ({
      walletAddress: user.wallet_address,
      username: user.username,
      publicKey: user.public_key,
      isOnline: activeConnections.has(user.wallet_address),
      status: userStatuses.get(user.wallet_address) || user.status || 'offline',
    }));

    res.json(results);
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Get user's status
app.get('/api/users/:walletAddress/status', (req, res) => {
  try {
    const { walletAddress } = req.params;
    const address = walletAddress.toLowerCase();

    res.json({
      walletAddress: address,
      isOnline: activeConnections.has(address),
      status: userStatuses.get(address) || 'offline',
      lastSeen: Date.now(), // In production, track actual last seen
    });
  } catch (error) {
    console.error('Error fetching status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// ============================================
// NFT DOMAIN PROFILE RESOLVER ENDPOINTS
// ============================================

// Resolve NFT domain profile by username
app.get('/api/profile/resolve/:username', async (req, res) => {
  try {
    const { username } = req.params;

    if (!username || username.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid username',
        username,
      });
    }

    const nftUsername = profileResolver.extractNftUsername(username);

    let profile = null;
    try {
      profile = await profileResolver.resolveProfile(nftUsername);
    } catch (resolveError) {
      console.error('Profile resolution error:', resolveError);
      // Don't throw 500, just return not found
    }

    if (!profile) {
      return res.status(404).json({
        error: 'Profile not found',
        username,
        resolverUrl: profileResolver.getResolverUrl(nftUsername),
      });
    }

    res.json({
      success: true,
      profile,
      resolverUrl: profileResolver.getResolverUrl(nftUsername),
    });
  } catch (error) {
    console.error('Error resolving profile:', error);
    res.status(404).json({
      error: 'Profile not found',
      username: req.params.username,
    });
  }
});

// Resolve multiple profiles at once
app.post('/api/profile/resolve/batch', async (req, res) => {
  try {
    const { usernames } = req.body;

    if (!Array.isArray(usernames)) {
      return res.status(400).json({ error: 'usernames must be an array' });
    }

    const nftUsernames = usernames.map(u => profileResolver.extractNftUsername(u));
    const profiles = await profileResolver.resolveProfiles(nftUsernames);

    const results: Record<string, any> = {};
    profiles.forEach((profile, username) => {
      results[username] = {
        profile,
        resolverUrl: profileResolver.getResolverUrl(username),
      };
    });

    res.json(results);
  } catch (error) {
    console.error('Error resolving profiles:', error);
    res.status(500).json({ error: 'Failed to resolve profiles' });
  }
});

// Get resolver URL for a username
app.get('/api/profile/resolver-url/:username', (req, res) => {
  const { username } = req.params;
  const nftUsername = profileResolver.extractNftUsername(username);

  res.json({
    username,
    nftUsername,
    resolverUrl: profileResolver.getResolverUrl(nftUsername),
    isBlockStarDomain: profileResolver.isBlockStarDomain(username),
  });
});

// Clear profile cache (admin endpoint)
app.post('/api/profile/cache/clear', (req, res) => {
  const { username } = req.body;
  profileResolver.clearProfileCache(username);

  res.json({
    success: true,
    message: username ? `Cache cleared for ${username}` : 'All profile cache cleared',
  });
});

// Get user profile by wallet address
app.get('/api/profile/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const address = walletAddress.toLowerCase();

    // Get user from database
    const user = await db.getUser(address);

    if (user && user.username) {
      res.json({
        success: true,
        profile: {
          walletAddress: user.wallet_address,
          nftName: user.username,  // username contains the NFT name like "blockstar"
          publicKey: user.public_key,
          status: user.status || 'offline',
        },
      });
    } else {
      res.json({
        success: false,
        profile: null,
      });
    }
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ============================================
// CONVERSATION & MESSAGE SYNC ENDPOINTS
// ============================================

// Get all conversations for a user
app.get('/api/conversations/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const address = walletAddress.toLowerCase();

    const conversations = await db.getUserConversations(address);

    // Enrich conversations with last message
    const enrichedConversations = await Promise.all(
      conversations.map(async (conv) => {
        const messages = await db.getMessages(conv._id!.toString(), 1);
        const lastMessage = messages.length > 0 ? messages[0] : null;

        // Cast to any to access group-specific fields
        const convAny = conv as any;

        return {
          id: convAny.group_id || conv._id!.toString(),  // Use frontend group_id if available
          type: conv.type,
          participants: conv.participants,
          name: conv.name,
          avatarUrl: conv.avatar_url,
          createdAt: conv.created_at.getTime(),
          updatedAt: conv.updated_at.getTime(),
          // Group-specific fields
          groupName: conv.name,  // Also return as groupName for frontend compatibility
          groupAvatar: conv.avatar_url,
          admins: convAny.admins || [],
          createdBy: convAny.created_by || '',
          lastMessage: lastMessage ? {
            id: lastMessage._id!.toString(),
            content: lastMessage.content,
            senderWallet: lastMessage.sender_wallet,
            timestamp: lastMessage.created_at.getTime(),
            type: lastMessage.message_type,
          } : null,
        };
      })
    );

    res.json({
      success: true,
      conversations: enrichedConversations,
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get messages for a conversation
app.get('/api/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit = '50', before } = req.query;

    const beforeDate = before ? new Date(parseInt(before as string)) : undefined;
    const messages = await db.getMessages(conversationId, parseInt(limit as string), beforeDate);

    const formattedMessages = messages.map(msg => ({
      id: msg.client_id || msg._id!.toString(),  // Use client_id for frontend consistency
      conversationId: msg.conversation_id,
      senderWallet: msg.sender_wallet,
      content: msg.content,
      type: msg.message_type,
      delivered: msg.delivered,
      readBy: msg.read_by || [],  // Ensure array even if empty
      timestamp: msg.created_at.getTime(),
    }));

    res.json({
      success: true,
      messages: formattedMessages,
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get or create a direct conversation
app.post('/api/conversations/direct', async (req, res) => {
  try {
    const { user1, user2 } = req.body;

    if (!user1 || !user2) {
      return res.status(400).json({ error: 'Both user1 and user2 are required' });
    }

    const conversationId = await db.getOrCreateDirectConversation(user1, user2);
    const conversation = await db.getConversationById(conversationId);

    res.json({
      success: true,
      conversation: {
        id: conversationId,
        type: conversation?.type || 'direct',
        participants: conversation?.participants || [user1.toLowerCase(), user2.toLowerCase()],
        createdAt: conversation?.created_at.getTime(),
        updatedAt: conversation?.updated_at.getTime(),
      },
    });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// Mark messages as read
app.post('/api/conversations/:conversationId/read', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    await db.markMessagesRead(conversationId, walletAddress);

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// Delete a conversation
app.delete('/api/conversations/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;

    // Delete all messages in the conversation
    await db.deleteConversationMessages(conversationId);

    // Delete the conversation
    await db.deleteConversation(conversationId);

    res.json({ success: true, message: 'Conversation deleted' });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// Delete a single message (soft delete)
app.delete('/api/messages/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;

    const deleted = await db.softDeleteMessage(messageId);

    if (deleted) {
      res.json({ success: true, message: 'Message deleted' });
    } else {
      res.status(404).json({ success: false, error: 'Message not found' });
    }
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Save a message via REST (backup for when WebSocket fails)
app.post('/api/messages', async (req, res) => {
  try {
    const { conversationId, senderWallet, content, messageType = 'text' } = req.body;

    if (!conversationId || !senderWallet || !content) {
      return res.status(400).json({ error: 'conversationId, senderWallet, and content are required' });
    }

    const message = await db.saveMessage(conversationId, senderWallet, content, messageType);

    res.json({
      success: true,
      message: {
        id: message._id!.toString(),
        conversationId: message.conversation_id,
        senderWallet: message.sender_wallet,
        content: message.content,
        type: message.message_type,
        timestamp: message.created_at.getTime(),
      },
    });
  } catch (error) {
    console.error('Error saving message:', error);
    res.status(500).json({ error: 'Failed to save message' });
  }
});

// Sync endpoint - get all data for a user (conversations + recent messages)
app.get('/api/sync/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const address = walletAddress.toLowerCase();

    // Get user data
    const user = await db.getUserByWallet(address);

    // Get all conversations
    const conversations = await db.getUserConversations(address);

    // Get messages for each conversation (last 50 per conversation)
    const conversationsWithMessages = await Promise.all(
      conversations.map(async (conv) => {
        const messages = await db.getMessages(conv._id!.toString(), 50);

        return {
          id: conv._id!.toString(),
          type: conv.type,
          participants: conv.participants,
          name: conv.name,
          avatarUrl: conv.avatar_url,
          createdAt: conv.created_at.getTime(),
          updatedAt: conv.updated_at.getTime(),
          messages: messages.map(msg => {
            // Ensure content is always a string
            let contentStr: string;
            if (typeof msg.content === 'object' && msg.content !== null) {
              contentStr = JSON.stringify(msg.content);
            } else if (typeof msg.content === 'string') {
              contentStr = msg.content;
            } else {
              contentStr = String(msg.content || '');
            }

            return {
              id: msg.client_id || msg._id!.toString(),  // Use client_id if available
              conversationId: msg.conversation_id,
              senderWallet: msg.sender_wallet,
              content: contentStr,
              type: msg.message_type,
              delivered: msg.delivered,
              readBy: msg.read_by,
              timestamp: msg.created_at.getTime(),
            };
          }),
        };
      })
    );

    res.json({
      success: true,
      user: user ? {
        walletAddress: user.wallet_address,
        username: user.username,
        publicKey: user.public_key,
        status: user.status,
        lastSeen: user.last_seen.getTime(),
      } : null,
      conversations: conversationsWithMessages,
      syncedAt: Date.now(),
    });
  } catch (error) {
    console.error('Error syncing data:', error);
    res.status(500).json({ error: 'Failed to sync data' });
  }
});

// ============================================
// FILE UPLOAD ENDPOINTS
// ============================================

// Upload a single file
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Get base URL and ensure it's HTTPS in production
    let baseUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    // Force HTTPS for non-localhost URLs
    if (!baseUrl.includes('localhost') && baseUrl.startsWith('http://')) {
      baseUrl = baseUrl.replace('http://', 'https://');
    }

    const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;

    console.log('File uploaded:', {
      originalName: req.file.originalname,
      storedAs: req.file.filename,
      url: fileUrl,
    });

    res.json({
      success: true,
      file: {
        id: req.file.filename.split('.')[0],
        filename: req.file.filename, // Return ACTUAL stored filename, not original
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        url: fileUrl,
      },
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Upload multiple files
app.post('/api/upload/multiple', upload.array('files', 5), (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Get base URL and ensure it's HTTPS in production
    let baseUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    if (!baseUrl.includes('localhost') && baseUrl.startsWith('http://')) {
      baseUrl = baseUrl.replace('http://', 'https://');
    }

    const uploadedFiles = files.map(file => ({
      id: file.filename.split('.')[0],
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      url: `${baseUrl}/uploads/${file.filename}`,
    }));

    res.json({
      success: true,
      files: uploadedFiles,
    });
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

// Delete a file
app.delete('/api/upload/:fileId', (req, res) => {
  try {
    const { fileId } = req.params;
    const files = fs.readdirSync(uploadsDir);
    const fileToDelete = files.find(f => f.startsWith(fileId));

    if (fileToDelete) {
      fs.unlinkSync(path.join(uploadsDir, fileToDelete));
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// ============================================
// WEBSOCKET HANDLERS
// ============================================

io.on('connection', (socket: Socket) => {
  console.log('Client connected:', socket.id);

  const { walletAddress, publicKey, username } = socket.handshake.auth;

  if (!walletAddress) {
    console.log('Connection rejected: no wallet address');
    socket.disconnect();
    return;
  }

  const address = walletAddress.toLowerCase();

  // Register connection
  activeConnections.set(address, socket.id);
  socketToWallet.set(socket.id, address);
  userStatuses.set(address, 'online');

  // Auto-register public key if provided - save to database
  if (publicKey) {
    db.upsertUser(address, publicKey, username).catch(err => {
      console.error('Failed to save user to database:', err);
    });
  }

  // Update user status in database
  db.updateUserStatus(address, 'online').catch(err => {
    console.error('Failed to update user status:', err);
  });

  console.log(`User ${address} connected`);

  // Broadcast online status to all
  socket.broadcast.emit('user:status', {
    address,
    status: 'online',
  });

  // Deliver any queued offline messages from database
  db.getOfflineMessages(address).then(queued => {
    if (queued && queued.length > 0) {
      console.log(`Delivering ${queued.length} offline messages to ${address}`);
      queued.forEach((msg) => {
        socket.emit('message', {
          // Use client_id if available, otherwise fall back to MongoDB _id
          id: msg.client_id || msg._id?.toString(),
          senderId: msg.sender_wallet,
          recipientId: msg.recipient_wallet,
          content: msg.content,
          timestamp: new Date(msg.created_at).getTime(),
          type: msg.message_type,
        });
      });
      db.clearOfflineMessages(address).catch(console.error);
    }
  }).catch(console.error);

  // ----------------------
  // Key Exchange Events
  // ----------------------

  // Request another user's public key
  socket.on('key:request', async ({ targetAddress }: { targetAddress: string }) => {
    const target = targetAddress.toLowerCase();
    try {
      const user = await db.getUserByWallet(target);

      if (user) {
        socket.emit('key:response', {
          walletAddress: target,
          publicKey: user.public_key,
          username: user.username,
        });
      } else {
        socket.emit('key:response', {
          walletAddress: target,
          error: 'User not found',
        });
      }
    } catch (error) {
      console.error('Error fetching user key:', error);
      socket.emit('key:response', {
        walletAddress: target,
        error: 'Failed to fetch user',
      });
    }
  });

  // Update own public key
  socket.on('key:update', async ({ publicKey: newKey }: { publicKey: string }) => {
    try {
      await db.upsertUser(address, newKey);
      socket.emit('key:updated', { success: true });
    } catch (error) {
      console.error('Error updating key:', error);
      socket.emit('key:updated', { success: false, error: 'Failed to update key' });
    }
  });

  // ----------------------
  // Messaging Events
  // ----------------------

  socket.on('message:send', async (message: any) => {
    try {
      const recipientAddress = typeof message.recipientId === 'string'
        ? message.recipientId.toLowerCase()
        : null;

      if (!recipientAddress) {
        socket.emit('error', { message: 'Invalid recipient' });
        return;
      }

      console.log(`Message from ${address} to ${recipientAddress}`);

      // Messages are sent as plaintext for reliable delivery
      const contentToStore = message.content;

      // Get or create conversation and save message to database
      let conversationId: string | null = null;
      try {
        conversationId = await db.getOrCreateDirectConversation(address, recipientAddress);
        // Pass client-generated message ID for read receipt tracking
        await db.saveMessage(conversationId, address, contentToStore, message.type || 'text', message.id);
      } catch (dbError) {
        console.error('Failed to save message to database:', dbError);
        // Continue with delivery even if DB save fails
      }

      const recipientSocketId = activeConnections.get(recipientAddress);

      if (recipientSocketId) {
        // Recipient is online - deliver immediately
        io.to(recipientSocketId).emit('message', {
          id: message.id,
          senderId: message.senderId,
          recipientId: message.recipientId,
          content: message.content,
          type: message.type,
          timestamp: message.timestamp,
          conversationId: conversationId,
          deliveredAt: Date.now(),
        });

        // Also send conversation ID back to sender
        socket.emit('message:delivered', {
          messageId: message.id,
          conversationId: conversationId,
          timestamp: Date.now(),
        });
      } else {
        // Recipient is offline - queue message in database
        try {
          await db.queueOfflineMessage(
            recipientAddress,
            address,
            message.content, // Plaintext content
            message.type || 'text',
            message.id  // Pass client-generated ID for read receipt tracking
          );
          console.log(`Message queued in DB for offline user ${recipientAddress}`);
        } catch (dbError) {
          console.error('Failed to queue offline message:', dbError);
        }

        // Acknowledge to sender (will be delivered when recipient comes online)
        socket.emit('message:queued', {
          messageId: message.id,
          recipientAddress,
        });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('message:delivered', async ({ messageId }: { messageId: string }) => {
    try {
      console.log('✓ Message delivered:', messageId, 'by:', address);

      // Get the message to find the sender
      const message = await db.getMessageById(messageId);

      if (message && message.senderId) {
        const senderId = message.senderId.toLowerCase();

        // Don't notify if the reader is the sender
        if (senderId !== address.toLowerCase()) {
          const senderSocketId = activeConnections.get(senderId);

          if (senderSocketId) {
            console.log(`✓ Notifying ${senderId} that message ${messageId} was delivered`);
            io.to(senderSocketId).emit('message:delivered', {
              messageId,
              deliveredTo: address,
              deliveredAt: Date.now(),
            });
          }
        }
      }
    } catch (error) {
      console.error('Error handling message:delivered:', error);
    }
  });

  socket.on('message:read', async ({ messageId }: { messageId: string }) => {
    try {
      // Mark the message as read in the database and get the sender
      const result = await db.markSingleMessageRead(messageId, address);

      if (result && result.senderId) {
        // Only notify if sender is different from reader
        if (result.senderId.toLowerCase() !== address.toLowerCase()) {
          const senderSocketId = activeConnections.get(result.senderId.toLowerCase());
          if (senderSocketId) {
            console.log(`📖 Notifying ${result.senderId} that message ${messageId} was read by ${address}`);
            io.to(senderSocketId).emit('message:read', {
              messageId,
              readBy: address,
              readAt: Date.now()
            });
          }
        }
      }
    } catch (error) {
      console.error('Error handling message:read:', error);
    }
  });

  // ----------------------
  // Status Events
  // ----------------------

  socket.on('user:status', ({ status }: { status: string }) => {
    userStatuses.set(address, status);
    socket.broadcast.emit('user:status', {
      address,
      status,
    });
  });

  // ----------------------
  // Call Events
  // ----------------------

  socket.on('call:initiate', ({ recipientAddress, callType, offer, callId }: any) => {
    try {
      const recipient = recipientAddress.toLowerCase();
      const recipientSocketId = activeConnections.get(recipient);

      if (recipientSocketId) {
        // Use the callId provided by the caller, or create one if not provided (backward compatibility)
        const finalCallId = callId || `${address}-${recipient}-${Date.now()}`;

        console.log('Call initiated:', {
          from: address,
          to: recipient,
          callId: finalCallId,
          type: callType
        });

        io.to(recipientSocketId).emit('call:incoming', {
          callerId: address,
          callType,
          offer,
          callId: finalCallId,
        });

        // Confirm call initiated to caller with the SAME call ID
        socket.emit('call:initiated', { callId: finalCallId, recipientAddress: recipient });
      } else {
        socket.emit('call:unavailable', {
          recipientAddress: recipient,
          reason: 'User is offline',
        });
      }
    } catch (error) {
      console.error('Error initiating call:', error);
      socket.emit('error', { message: 'Failed to initiate call' });
    }
  });

  socket.on('call:answer', ({ callId, answer }: any) => {
    try {
      // CallId format: callerAddress-recipientAddress-timestamp
      // Ethereum addresses are 42 chars (0x + 40 hex)
      const callerAddress = callId.substring(0, 42).toLowerCase();
      const callerSocketId = activeConnections.get(callerAddress);

      console.log('Call answer received:', { callId, callerAddress, callerSocketId: !!callerSocketId });

      if (callerSocketId) {
        io.to(callerSocketId).emit('call:answer', {
          callId,
          answer,
          from: address,
        });
        console.log('Sent call:answer to caller');
      } else {
        console.log('Caller not found in activeConnections');
      }
    } catch (error) {
      console.error('Error answering call:', error);
    }
  });

  socket.on('call:ice-candidate', ({ recipientAddress, candidate, callId }: any) => {
    try {
      const recipient = recipientAddress.toLowerCase();
      const recipientSocketId = activeConnections.get(recipient);

      if (recipientSocketId) {
        console.log(`Relaying ICE candidate from ${address} to ${recipient} for call ${callId}`);
        io.to(recipientSocketId).emit('call:ice-candidate', {
          from: address,
          candidate,
          callId,
        });
      } else {
        console.log(`Cannot relay ICE candidate - ${recipient} not connected`);
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  });

  socket.on('call:end', ({ callId }: { callId: string }) => {
    try {
      // Notify all parties in the call
      const parts = callId.split('-');
      const otherParty = parts[0] === address ? parts[1] : parts[0];
      const otherSocketId = activeConnections.get(otherParty);

      if (otherSocketId) {
        io.to(otherSocketId).emit('call:ended', { callId, endedBy: address });
      }
    } catch (error) {
      console.error('Error ending call:', error);
    }
  });

  // ----------------------
  // Group Events
  // ----------------------

  socket.on('group:create', async ({ group, members }: any) => {
    try {
      // Save the group to database
      await db.createGroupConversation(group);
      console.log(`📢 Group "${group.groupName}" created by ${address} with members:`, members);

      // Notify all members about the new group
      members.forEach((memberAddress: string) => {
        const memberSocketId = activeConnections.get(memberAddress.toLowerCase());
        if (memberSocketId && memberAddress.toLowerCase() !== address) {
          io.to(memberSocketId).emit('group:created', { group, createdBy: address });
        }
      });
    } catch (error) {
      console.error('Error creating group:', error);
    }
  });

  socket.on('group:message', async ({ groupId, message, recipients }: any) => {
    try {
      console.log(`📢 Group message in ${groupId} from ${address}:`, message.content?.substring(0, 30));

      // Save message to database
      await db.saveMessage(
        groupId,
        address,
        message.content,
        message.type || 'text',
        message.id
      );

      // Forward to all recipients
      for (const recipientAddress of recipients) {
        const recipientSocketId = activeConnections.get(recipientAddress.toLowerCase());
        if (recipientSocketId) {
          io.to(recipientSocketId).emit('message', {
            ...message,
            conversationId: groupId,
            senderId: address,
          });
          console.log(`   → Sent to ${recipientAddress}`);
        } else {
          // Queue for offline delivery
          await db.queueOfflineMessage(recipientAddress, message.id, message);
          console.log(`   → Queued offline for ${recipientAddress}`);
        }
      }
    } catch (error) {
      console.error('Error handling group message:', error);
    }
  });

  // ----------------------
  // Disconnect
  // ----------------------

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    if (address) {
      activeConnections.delete(address);
      socketToWallet.delete(socket.id);
      userStatuses.set(address, 'offline');

      // Broadcast offline status
      socket.broadcast.emit('user:status', {
        address,
        status: 'offline',
      });
    }
  });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3001;

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database connection
    const dbInitialized = await db.initializeDatabase();

    if (!dbInitialized) {
      console.error('❌ Failed to connect to MongoDB. Running without persistence.');
      console.error('   Messages and keys will NOT be saved!');
      console.error('   Set MONGODB_URI environment variable to enable persistence.');
    }

    httpServer.listen(PORT, () => {
      console.log('');
      console.log('══════════════════════════════════════════════════════════════');
      console.log(`🚀 BlockStar Cypher Server running on port ${PORT}`);
      console.log('══════════════════════════════════════════════════════════════');
      console.log('');
      console.log('📦 Database:', dbInitialized ? 'Connected (MongoDB)' : 'NOT CONNECTED');
      console.log('');
      console.log('🔗 Endpoints:');
      console.log(`   Health check: http://localhost:${PORT}/health`);
      console.log(`   Key registration: POST http://localhost:${PORT}/api/keys/register`);
      console.log(`   Get user key: GET http://localhost:${PORT}/api/keys/:address`);
      console.log('');
      console.log('══════════════════════════════════════════════════════════════');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await db.closeDatabase();
  httpServer.close(() => {
    console.log('HTTP server closed');
  });
});
