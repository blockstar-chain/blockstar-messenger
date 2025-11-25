import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

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

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// ============================================
// IN-MEMORY STORES (Use Redis/DB in production)
// ============================================

// User public keys registry
interface UserKeys {
  walletAddress: string;
  publicKey: string;
  username?: string;
  registeredAt: number;
  updatedAt: number;
}
const userKeys = new Map<string, UserKeys>();

// Active connections
const activeConnections = new Map<string, string>(); // walletAddress -> socketId
const socketToWallet = new Map<string, string>(); // socketId -> walletAddress

// User statuses
const userStatuses = new Map<string, string>(); // walletAddress -> status

// Offline message queue
interface QueuedMessage {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  timestamp: number;
  type: string;
}
const offlineMessages = new Map<string, QueuedMessage[]>(); // recipientAddress -> messages[]

// ============================================
// REST API ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeConnections: activeConnections.size,
    registeredUsers: userKeys.size,
    timestamp: Date.now(),
  });
});

// Register or update user's public key
app.post('/api/keys/register', (req, res) => {
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

    const existing = userKeys.get(walletAddress.toLowerCase());
    const now = Date.now();

    userKeys.set(walletAddress.toLowerCase(), {
      walletAddress: walletAddress.toLowerCase(),
      publicKey,
      username: username || existing?.username,
      registeredAt: existing?.registeredAt || now,
      updatedAt: now,
    });

    console.log(`Key registered for ${walletAddress}`);

    res.json({ 
      success: true, 
      message: 'Public key registered successfully',
      registeredAt: existing?.registeredAt || now,
    });
  } catch (error) {
    console.error('Error registering key:', error);
    res.status(500).json({ error: 'Failed to register key' });
  }
});

// Get a user's public key
app.get('/api/keys/:walletAddress', (req, res) => {
  try {
    const { walletAddress } = req.params;
    const userData = userKeys.get(walletAddress.toLowerCase());

    if (!userData) {
      return res.status(404).json({ 
        error: 'User not found',
        walletAddress 
      });
    }

    res.json({
      walletAddress: userData.walletAddress,
      publicKey: userData.publicKey,
      username: userData.username,
      isOnline: activeConnections.has(walletAddress.toLowerCase()),
      status: userStatuses.get(walletAddress.toLowerCase()) || 'offline',
    });
  } catch (error) {
    console.error('Error fetching key:', error);
    res.status(500).json({ error: 'Failed to fetch key' });
  }
});

// Get multiple users' public keys
app.post('/api/keys/batch', (req, res) => {
  try {
    const { addresses } = req.body;

    if (!Array.isArray(addresses)) {
      return res.status(400).json({ error: 'addresses must be an array' });
    }

    const results: Record<string, any> = {};

    for (const address of addresses) {
      const userData = userKeys.get(address.toLowerCase());
      if (userData) {
        results[address.toLowerCase()] = {
          publicKey: userData.publicKey,
          username: userData.username,
          isOnline: activeConnections.has(address.toLowerCase()),
          status: userStatuses.get(address.toLowerCase()) || 'offline',
        };
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Error fetching keys:', error);
    res.status(500).json({ error: 'Failed to fetch keys' });
  }
});

// Search users by username
app.get('/api/users/search', (req, res) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Search query required' });
    }

    const results: any[] = [];
    const searchLower = q.toLowerCase();

    userKeys.forEach((user) => {
      if (
        user.username?.toLowerCase().includes(searchLower) ||
        user.walletAddress.toLowerCase().includes(searchLower)
      ) {
        results.push({
          walletAddress: user.walletAddress,
          username: user.username,
          publicKey: user.publicKey,
          isOnline: activeConnections.has(user.walletAddress),
          status: userStatuses.get(user.walletAddress) || 'offline',
        });
      }
    });

    res.json(results.slice(0, 20)); // Limit to 20 results
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
// FILE UPLOAD ENDPOINTS
// ============================================

// Upload a single file
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `${process.env.BACKEND_URL || 'http://localhost:3001'}/uploads/${req.file.filename}`;
    
    res.json({
      success: true,
      file: {
        id: req.file.filename.split('.')[0],
        filename: req.file.originalname,
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

    const uploadedFiles = files.map(file => ({
      id: file.filename.split('.')[0],
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/uploads/${file.filename}`,
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

  // Auto-register public key if provided
  if (publicKey) {
    const existing = userKeys.get(address);
    userKeys.set(address, {
      walletAddress: address,
      publicKey,
      username: username || existing?.username,
      registeredAt: existing?.registeredAt || Date.now(),
      updatedAt: Date.now(),
    });
  }

  console.log(`User ${address} connected`);

  // Broadcast online status to all
  socket.broadcast.emit('user:status', {
    address,
    status: 'online',
  });

  // Deliver any queued offline messages
  const queued = offlineMessages.get(address);
  if (queued && queued.length > 0) {
    console.log(`Delivering ${queued.length} offline messages to ${address}`);
    queued.forEach((msg) => {
      socket.emit('message', msg);
    });
    offlineMessages.delete(address);
  }

  // ----------------------
  // Key Exchange Events
  // ----------------------

  // Request another user's public key
  socket.on('key:request', ({ targetAddress }: { targetAddress: string }) => {
    const target = targetAddress.toLowerCase();
    const userData = userKeys.get(target);

    if (userData) {
      socket.emit('key:response', {
        walletAddress: target,
        publicKey: userData.publicKey,
        username: userData.username,
      });
    } else {
      socket.emit('key:response', {
        walletAddress: target,
        error: 'User not found',
      });
    }
  });

  // Update own public key
  socket.on('key:update', ({ publicKey: newKey }: { publicKey: string }) => {
    const existing = userKeys.get(address);
    if (existing) {
      userKeys.set(address, {
        ...existing,
        publicKey: newKey,
        updatedAt: Date.now(),
      });
      socket.emit('key:updated', { success: true });
    }
  });

  // ----------------------
  // Messaging Events
  // ----------------------

  socket.on('message:send', (message: any) => {
    try {
      const recipientAddress = typeof message.recipientId === 'string' 
        ? message.recipientId.toLowerCase()
        : null;

      if (!recipientAddress) {
        socket.emit('error', { message: 'Invalid recipient' });
        return;
      }

      console.log(`Message from ${address} to ${recipientAddress}`);

      const recipientSocketId = activeConnections.get(recipientAddress);

      if (recipientSocketId) {
        // Recipient is online - deliver immediately
        io.to(recipientSocketId).emit('message', {
          ...message,
          deliveredAt: Date.now(),
        });

        // Confirm delivery to sender
        socket.emit('message:delivered', {
          messageId: message.id,
          timestamp: Date.now(),
        });
      } else {
        // Recipient is offline - queue message
        const queue = offlineMessages.get(recipientAddress) || [];
        queue.push({
          ...message,
          queuedAt: Date.now(),
        });
        offlineMessages.set(recipientAddress, queue);

        console.log(`Message queued for offline user ${recipientAddress}`);
        
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

  socket.on('message:delivered', ({ messageId }: { messageId: string }) => {
    // Could notify sender that message was delivered
    console.log('Message delivered:', messageId);
  });

  socket.on('message:read', ({ messageId, senderId }: { messageId: string; senderId: string }) => {
    // Notify sender that message was read
    const senderSocketId = activeConnections.get(senderId.toLowerCase());
    if (senderSocketId) {
      io.to(senderSocketId).emit('message:read', { messageId, readBy: address });
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

  socket.on('call:ice-candidate', ({ recipientAddress, candidate }: any) => {
    try {
      const recipient = recipientAddress.toLowerCase();
      const recipientSocketId = activeConnections.get(recipient);

      if (recipientSocketId) {
        io.to(recipientSocketId).emit('call:ice-candidate', {
          from: address,
          candidate,
        });
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

  socket.on('group:create', ({ group, members }: any) => {
    // Notify all members about the new group
    members.forEach((memberAddress: string) => {
      const memberSocketId = activeConnections.get(memberAddress.toLowerCase());
      if (memberSocketId && memberAddress.toLowerCase() !== address) {
        io.to(memberSocketId).emit('group:created', { group, createdBy: address });
      }
    });
  });

  socket.on('group:message', ({ groupId, messages }: any) => {
    // Forward messages to all group members
    // In production, look up group members from database
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

httpServer.listen(PORT, () => {
  console.log(`🚀 BlockStar Messenger Server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Key registration: POST http://localhost:${PORT}/api/keys/register`);
  console.log(`   Get user key: GET http://localhost:${PORT}/api/keys/:address`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  httpServer.close(() => {
    console.log('HTTP server closed');
  });
});
