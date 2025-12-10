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
import pushService from './services/pushNotificationService';



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


app.get('/test-apns-config', async (req, res) => {


  const checks = {
    keyId: !!process.env.APNS_KEY_ID,
    teamId: !!process.env.APNS_TEAM_ID,
    bundleId: !!process.env.APNS_BUNDLE_ID,
    keyPath: process.env.APNS_KEY_PATH || 'Not set',
    keyFileExists: false,
    keyFileReadable: false,
  };

  // Check if key file exists
  if (process.env.APNS_KEY_PATH) {
    const keyPath = path.resolve(process.env.APNS_KEY_PATH);
    checks.keyFileExists = fs.existsSync(keyPath);

    if (checks.keyFileExists) {
      try {
        fs.readFileSync(keyPath, 'utf8');
        checks.keyFileReadable = true;
      } catch (err) {
        checks.keyFileReadable = false;
      }
    }
  }

  const allGood = Object.values(checks).every(v => v === true || typeof v === 'string');

  res.json({
    status: allGood ? '✅ APNs Configuration Valid' : '❌ Configuration Issues',
    checks,
    environment: process.env.NODE_ENV || 'development',
    message: allGood
      ? 'APNs is properly configured. Ready for real device testing.'
      : 'Fix the issues above before testing with real devices.'
  });
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
const lastSeenTimes = new Map<string, number>(); // walletAddress -> timestamp

// ============================================
// REST API ENDPOINTS
// ============================================

app.get('/test-push', async (req, res) => {
  let recipient = "0xf93389abc18a6acdea5127c727e350bdf7f81156"
  let finalCallId = "0xad5292d3d35f57cc0d7876cfd7b583dc99637b0d-0xf93389abc18a6acdea5127c727e350bdf7f81156-1765169684666"
  let address = "0xad5292d3d35f57cc0d7876cfd7b583dc99637b0d"
  let displayName = "blockstardev"
  let callType = "audio"
  const pushSent = await sendCallPushNotification(
    recipient,
    finalCallId,
    address,
    displayName,
    callType
  );

  console.log(pushSent)
})

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

// Alias for /api/health (used by mesh network service)
app.get('/api/health', async (req, res) => {
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

// Check if push token exists for a wallet (used by app on startup)
app.get('/api/push-token/check/:walletAddress', async (req, res) => {
  const { walletAddress } = req.params;

  if (!walletAddress) {
    return res.status(400).json({
      success: false,
      error: 'walletAddress is required'
    });
  }

  try {
    const tokens = await db.getPushTokens(walletAddress.toLowerCase());
    
    console.log(`📱 Token check for ${walletAddress}: ${tokens.length} token(s) found`);
    
    res.json({
      success: true,
      hasToken: tokens.length > 0,
      tokenCount: tokens.length,
      platforms: tokens.map(t => t.platform),
    });
  } catch (error) {
    console.error('Error checking push token:', error);
    res.status(500).json({ success: false, error: 'Failed to check push token' });
  }
});

// Get push token status with detailed info
app.get('/api/push-token/status/:walletAddress', async (req, res) => {
  const { walletAddress } = req.params;

  if (!walletAddress) {
    return res.status(400).json({
      success: false,
      error: 'walletAddress is required'
    });
  }

  try {
    const tokens = await db.getPushTokens(walletAddress.toLowerCase());
    
    const firebaseReady = pushService.firebaseInitialized? true : false;
    
    res.json({
      success: true,
      enabled: tokens.length > 0,
      tokenCount: tokens.length,
      tokens: tokens.map(t => ({
        platform: t.platform,
        tokenPreview: t.push_token ? t.push_token.substring(0, 20) + '...' : null,
        updatedAt: t.updated_at,
      })),
      firebaseReady,
    });
  } catch (error) {
    console.error('Error getting push token status:', error);
    res.status(500).json({ success: false, error: 'Failed to get push token status' });
  }
});

// Force re-register push token (clears old tokens and adds new one)
app.post('/api/push-token/force-register', async (req, res) => {
  const { token, walletAddress, platform } = req.body;

  if (!token || !walletAddress || !platform) {
    return res.status(400).json({
      success: false,
      error: 'token, walletAddress, and platform are required'
    });
  }

  if (!['ios', 'android'].includes(platform)) {
    return res.status(400).json({
      success: false,
      error: 'platform must be ios or android'
    });
  }

  try {
    const normalizedAddress = walletAddress.toLowerCase();
    
    // Delete all existing tokens for this wallet on this platform
    // This ensures we don't have stale tokens
    const existingTokens = await db.getPushTokens(normalizedAddress);
    for (const existing of existingTokens) {
      if (existing.platform === platform && existing.push_token !== token) {
        await db.deletePushToken(normalizedAddress, existing.push_token);
        console.log(`📱 Removed old ${platform} token for ${walletAddress}`);
      }
    }

    // Save new token
    await db.savePushToken({
      wallet_address: normalizedAddress,
      push_token: token,
      platform,
      updated_at: new Date(),
    });

    console.log(`📱 Force-registered push token for ${walletAddress} (${platform})`);
    res.json({ success: true, message: 'Token force-registered successfully' });
  } catch (error) {
    console.error('Error force-registering push token:', error);
    res.status(500).json({ success: false, error: 'Failed to force-register push token' });
  }
});

// Test push notification to a specific wallet
app.post('/api/push-token/test', async (req, res) => {
  const { walletAddress } = req.body;

  if (!walletAddress) {
    return res.status(400).json({
      success: false,
      error: 'walletAddress is required'
    });
  }

  try {
    const tokens = await db.getPushTokens(walletAddress.toLowerCase());

    if (tokens.length === 0) {
      return res.json({
        success: false,
        error: 'No push tokens registered for this wallet',
        hint: 'The app needs to register a push token first'
      });
    }

    let sent = 0;
    let failed = 0;

    for (const { push_token, platform } of tokens) {
      try {
        const success = await pushService.sendFCMPush(
          push_token,
          {
            title: '🧪 Test Notification',
            body: 'Push notifications are working!',
            data: { type: 'test', timestamp: Date.now().toString() },
          },
          platform as 'ios' | 'android'
        );
        
        if (success) {
          sent++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error(`Test push failed for ${platform}:`, err);
        failed++;
      }
    }

    res.json({
      success: sent > 0,
      sent,
      failed,
      totalTokens: tokens.length,
      message: sent > 0 
        ? `Test notification sent to ${sent} device(s)` 
        : 'Failed to send test notification'
    });
  } catch (error) {
    console.error('Error sending test push:', error);
    res.status(500).json({ success: false, error: 'Failed to send test push' });
  }
});

app.post('/api/push-token', async (req, res) => {
  const { token, walletAddress, platform } = req.body;

  if (!token || !walletAddress || !platform) {
    return res.status(400).json({
      success: false,
      error: 'token, walletAddress, and platform are required'
    });
  }

  if (!['ios', 'android'].includes(platform)) {
    return res.status(400).json({
      success: false,
      error: 'platform must be ios or android'
    });
  }

  try {
    // Store token in database
    await db.savePushToken({
      wallet_address: walletAddress.toLowerCase(),
      push_token: token,
      platform, // 'ios' or 'android'
      updated_at: new Date(),
    });

    console.log(`📱 Push token registered for ${walletAddress} (${platform})`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving push token:', error);
    res.status(500).json({ success: false, error: 'Failed to save push token' });
  }
});

// Delete push token (for logout)
app.delete('/api/push-token', async (req, res) => {
  const { token, walletAddress } = req.body;

  if (!token || !walletAddress) {
    return res.status(400).json({
      success: false,
      error: 'token and walletAddress are required'
    });
  }

  try {
    await db.deletePushToken(walletAddress.toLowerCase(), token);
    console.log(`📱 Push token removed for ${walletAddress}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting push token:', error);
    res.status(500).json({ success: false, error: 'Failed to delete push token' });
  }
});


// Send call-specific push notification (high priority)
async function sendCallPushNotification(
  recipientWallet: string,
  callId: string,
  callerId: string,
  callerName: string | undefined,
  callType: any
): Promise<boolean> {
  try {
    const tokens = await db.getPushTokens(recipientWallet);

    if (tokens.length === 0) {
      console.log(`📱 No push tokens for ${recipientWallet.substring(0, 10)}... - cannot send call notification`);
      return false;
    }

    console.log(`📞 Sending call notification to ${tokens.length} device(s)`);

    let sent = false;
    for (const { push_token, platform } of tokens) {
      try {
        const success = await pushService.sendCallNotification(
          push_token,
          platform as 'ios' | 'android',
          {
            callId,
            callerId,
            callerName,
            callType,
          }
        );
        if (success) sent = true;
      } catch (err) {
        console.error(`Failed to send call push to ${platform}:`, err);
      }
    }

    return sent;
  } catch (error) {
    console.error('Error sending call push notification:', error);
    return false;
  }
}

// Helper function to truncate wallet address for display
function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

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
        success: false,
        error: 'User not found',
        walletAddress
      });
    }

    res.json({
      success: true,
      walletAddress: user.wallet_address,
      publicKey: user.public_key,
      username: user.username,
      isOnline: activeConnections.has(walletAddress.toLowerCase()),
      status: userStatuses.get(walletAddress.toLowerCase()) || user.status || 'offline',
    });
  } catch (error) {
    console.error('Error fetching key:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch key' });
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
    const isOnline = activeConnections.has(address);

    res.json({
      walletAddress: address,
      isOnline,
      status: userStatuses.get(address) || 'offline',
      lastSeen: isOnline ? Date.now() : (lastSeenTimes.get(address) || null),
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

    console.log(`🔍 [Resolve] Request for username: "${username}"`);

    if (!username || username.trim().length === 0) {
      console.log(`❌ [Resolve] Invalid/empty username`);
      return res.status(400).json({
        error: 'Invalid username',
        username,
      });
    }

    const nftUsername = profileResolver.extractNftUsername(username);
    console.log(`🔍 [Resolve] Extracted NFT username: "${nftUsername}"`);

    let profile = null;
    try {
      profile = await profileResolver.resolveProfile(nftUsername);
      console.log(`🔍 [Resolve] Profile result:`, profile ? `Found (wallet: ${profile.walletAddress})` : 'Not found');
    } catch (resolveError: any) {
      console.error('❌ [Resolve] Profile resolution error:', resolveError?.message || resolveError);
      // Don't throw 500, just return not found
    }

    if (!profile) {
      console.log(`❌ [Resolve] Returning 404 for "${username}"`);
      return res.status(404).json({
        error: 'Profile not found',
        username,
        resolverUrl: profileResolver.getResolverUrl(nftUsername),
      });
    }

    console.log(`✅ [Resolve] Success for "${username}" -> ${profile.walletAddress}`);
    res.json({
      success: true,
      profile,
      resolverUrl: profileResolver.getResolverUrl(nftUsername),
    });
  } catch (error: any) {
    console.error('❌ [Resolve] Outer error:', error?.message || error);
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

// Batch resolve profiles by wallet addresses
app.post('/api/profile/resolve/wallets', async (req, res) => {
  try {
    const { walletAddresses } = req.body;

    if (!Array.isArray(walletAddresses)) {
      return res.status(400).json({ error: 'walletAddresses must be an array' });
    }

    // Get users from database to find their usernames
    const users = await db.getUsersByWallets(walletAddresses);

    console.log(`📋 Resolving profiles for ${walletAddresses.length} wallets, found ${users.length} users in DB`);

    const results: Record<string, any> = {};

    // For users with usernames, resolve their full profiles
    const usernamesMap = new Map<string, string>(); // username -> wallet
    for (const user of users) {
      if (user.username) {
        usernamesMap.set(user.username, user.wallet_address);
      }
    }

    // Resolve profiles for users with usernames
    if (usernamesMap.size > 0) {
      const usernames = Array.from(usernamesMap.keys());
      const nftUsernames = usernames.map(u => profileResolver.extractNftUsername(u));
      const profiles = await profileResolver.resolveProfiles(nftUsernames);

      profiles.forEach((profile, username) => {
        const wallet = usernamesMap.get(username) || usernamesMap.get(username.toLowerCase());
        if (wallet) {
          results[wallet.toLowerCase()] = {
            profile,
            resolverUrl: profileResolver.getResolverUrl(username),
          };
        }
      });
    }

    // For wallets without profiles, return basic info from DB
    for (const user of users) {
      const wallet = user.wallet_address.toLowerCase();
      if (!results[wallet] && user.username) {
        results[wallet] = {
          profile: {
            username: user.username,
            fullUsername: user.username.includes('@') ? user.username : `${user.username}@blockstar`,
            walletAddress: user.wallet_address,
            avatar: null,
            records: {},
            subdomains: [],
            isSubdomain: false,
            mainDomain: user.username,
            subDomain: '',
            resolvedAt: Date.now(),
          },
          resolverUrl: profileResolver.getResolverUrl(user.username),
        };
      }
    }

    console.log(`📋 Resolved ${Object.keys(results).length} profiles`);

    res.json({
      success: true,
      profiles: results
    });
  } catch (error) {
    console.error('Error resolving profiles by wallets:', error);
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

// Debug endpoint to test profile resolution with detailed logging
app.get('/api/profile/debug/:username', async (req, res) => {
  const { username } = req.params;
  console.log('========================================');
  console.log(`🔬 DEBUG: Resolving profile for "${username}"`);
  console.log('Contract info:', profileResolver.getContractInfo());

  const startTime = Date.now();

  try {
    // Clear cache first to force fresh lookup
    profileResolver.clearProfileCache(username);

    const profile = await profileResolver.resolveProfile(username);
    const duration = Date.now() - startTime;

    console.log(`🔬 DEBUG: Resolution took ${duration}ms`);
    console.log(`🔬 DEBUG: Profile result:`, profile ? 'Found' : 'Not found');

    res.json({
      success: !!profile,
      username,
      duration: `${duration}ms`,
      profile,
      contractInfo: profileResolver.getContractInfo(),
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`🔬 DEBUG: Error after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      username,
      duration: `${duration}ms`,
      error: error?.message || 'Unknown error',
      contractInfo: profileResolver.getContractInfo(),
    });
  }
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

    // Log all conversations to debug
    const groups = conversations.filter(c => c.type === 'group');
    const directs = conversations.filter(c => c.type === 'direct');
    console.log(`📋 Returning ${conversations.length} total conversations for ${address}:`);
    console.log(`   - ${groups.length} groups, ${directs.length} direct chats`);
    groups.forEach((g: any) => {
      console.log(`   [GROUP] ${g.name || g.group_id}: created_by=${g.created_by}, admins=${JSON.stringify(g.admins)}`);
    });
    directs.forEach((d: any) => {
      console.log(`   [DIRECT] ${d._id}: participants=${JSON.stringify(d.participants)}`);
    });

    // Deduplicate groups by participants (in case of old data without group_id)
    const seenGroupParticipants = new Set<string>();
    const deduplicatedConversations = conversations.filter(conv => {
      if (conv.type === 'group') {
        const participantsKey = conv.participants.sort().join(',');
        if (seenGroupParticipants.has(participantsKey)) {
          console.log(`🔄 Skipping duplicate group with participants: ${participantsKey}`);
          return false;
        }
        seenGroupParticipants.add(participantsKey);
      }
      return true;
    });

    // Enrich conversations with last message
    const enrichedConversations = await Promise.all(
      deduplicatedConversations.map(async (conv) => {
        // Cast to any to access group-specific fields
        const convAny = conv as any;

        // For groups, use group_id for messages; for direct, use _id
        const conversationId = convAny.group_id || conv._id!.toString();
        const messages = await db.getMessages(conversationId, 1);
        const lastMessage = messages.length > 0 ? messages[0] : null;

        // Process lastMessage content for encrypted group messages
        let lastMessageContent = lastMessage?.content;
        if (lastMessage && lastMessageContent === '__ENCRYPTED_GROUP__') {
          const msgAny = lastMessage as any;
          if (msgAny.encrypted_payloads && msgAny.encrypted_payloads[address]) {
            // We have the user's encrypted payload, but can't decrypt on server
            // Just indicate it's encrypted
            lastMessageContent = '__ENCRYPTED_GROUP__';
          }
        }

        return {
          id: conversationId,  // Use group_id if available
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
            content: lastMessageContent,
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
    const { limit = '50', before, walletAddress } = req.query;
    const userAddress = walletAddress ? (walletAddress as string).toLowerCase() : null;

    const beforeDate = before ? new Date(parseInt(before as string)) : undefined;
    const messages = await db.getMessages(conversationId, parseInt(limit as string), beforeDate);

    const formattedMessages = messages.map(msg => {
      const msgAny = msg as any;
      let content = msg.content;

      // For encrypted group messages, get the user's specific encrypted content
      if (content === '__ENCRYPTED_GROUP__' && msgAny.encrypted_payloads && userAddress) {
        // Look up this user's encrypted payload
        const userPayload = msgAny.encrypted_payloads[userAddress];
        if (userPayload) {
          content = userPayload;
          console.log(`🔐 Found encrypted payload for ${userAddress} in message ${msg.client_id}`);
        } else {
          console.log(`⚠️ No encrypted payload for ${userAddress} in message ${msg.client_id}`);
        }
      }

      return {
        id: msg.client_id || msg._id!.toString(),  // Use client_id for frontend consistency
        conversationId: msg.conversation_id,
        senderWallet: msg.sender_wallet,
        content: content,
        type: msg.message_type,
        delivered: msg.delivered,
        readBy: msg.read_by || [],  // Ensure array even if empty
        reactions: msg.reactions || [],  // Include reactions
        timestamp: msg.created_at.getTime(),
      };
    });

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

// Cleanup duplicate groups for a user
app.post('/api/conversations/cleanup-duplicates', async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const result = await db.cleanupDuplicateGroups(walletAddress.toLowerCase());

    console.log(`🧹 Cleaned up ${result.removed} duplicate groups for ${walletAddress}`);
    res.json({ success: true, removed: result.removed, kept: result.kept });
  } catch (error) {
    console.error('Error cleaning up duplicates:', error);
    res.status(500).json({ error: 'Failed to cleanup duplicates' });
  }
});

// Get a single conversation by ID
app.get('/api/conversations/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;

    const conversation = await db.getConversationById(conversationId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const convAny = conversation as any;

    res.json({
      success: true,
      conversation: {
        id: convAny.group_id || conversation._id!.toString(),
        type: conversation.type,
        participants: conversation.participants,
        name: conversation.name,
        groupName: conversation.name,
        avatarUrl: conversation.avatar_url,
        groupAvatar: conversation.avatar_url,
        admins: convAny.admins || [],
        createdBy: convAny.created_by || '',
        createdAt: conversation.created_at.getTime(),
        updatedAt: conversation.updated_at.getTime(),
      },
    });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
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

// Hide conversation for a specific user (soft delete - only hides for this user)
app.post('/api/conversations/:conversationId/hide', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    // Add to hidden conversations for this user
    await db.hideConversationForUser(conversationId, walletAddress.toLowerCase());

    console.log(`🗑️ Hid conversation ${conversationId} for user ${walletAddress}`);
    res.json({ success: true, message: 'Conversation hidden' });
  } catch (error) {
    console.error('Error hiding conversation:', error);
    res.status(500).json({ error: 'Failed to hide conversation' });
  }
});

// Unhide conversation for a specific user (restore hidden conversation)
app.post('/api/conversations/:conversationId/unhide', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const normalizedAddress = walletAddress.toLowerCase();

    // Remove from hidden_for array
    await db.unhideConversationForUser(conversationId, normalizedAddress);

    console.log(`✅ Unhid conversation ${conversationId} for user ${walletAddress}`);
    res.json({ success: true, message: 'Conversation restored' });
  } catch (error) {
    console.error('Error unhiding conversation:', error);
    res.status(500).json({ error: 'Failed to unhide conversation' });
  }
});

// Debug: Get ALL conversations for a user including hidden ones
app.get('/api/conversations/:walletAddress/all', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const address = walletAddress.toLowerCase();

    const allConversations = await db.getAllUserConversations(address);

    const groups = allConversations.filter(c => c.type === 'group');
    const directs = allConversations.filter(c => c.type === 'direct');
    const hidden = allConversations.filter(c => (c as any).hidden_for?.includes(address));

    console.log(`📋 [DEBUG] ALL conversations for ${address}:`);
    console.log(`   - ${groups.length} groups, ${directs.length} direct chats`);
    console.log(`   - ${hidden.length} hidden`);

    res.json({
      success: true,
      total: allConversations.length,
      groups: groups.length,
      directs: directs.length,
      hidden: hidden.length,
      conversations: allConversations.map(c => ({
        id: (c as any).group_id || c._id?.toString(),
        type: c.type,
        name: c.name,
        participants: c.participants,
        hidden: (c as any).hidden_for?.includes(address) || false,
        created_at: c.created_at,
        updated_at: c.updated_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching all conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
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

// ============================================
// GROUP MANAGEMENT ENDPOINTS
// ============================================

// Add member to group
app.post('/api/groups/:groupId/members', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { memberAddress, adminAddress } = req.body;

    console.log('📝 Add member request:', { groupId, memberAddress, adminAddress });

    if (!memberAddress || !adminAddress) {
      return res.status(400).json({ error: 'memberAddress and adminAddress are required' });
    }

    // Debug: Check group data before operation
    const group = await db.getGroup(groupId);
    console.log('📝 Group data:', group ? {
      _id: group._id?.toString(),
      group_id: group.group_id,
      created_by: group.created_by,
      admins: group.admins,
      participantCount: group.participants?.length
    } : 'NOT FOUND');

    const success = await db.addGroupMember(groupId, memberAddress, adminAddress);

    if (success) {
      res.json({ success: true, message: 'Member added successfully' });
    } else {
      console.error('❌ Add member failed - not authorized or group not found');
      res.status(403).json({ success: false, error: 'Not authorized or group not found' });
    }
  } catch (error) {
    console.error('Error adding group member:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// Remove member from group
app.delete('/api/groups/:groupId/members/:memberAddress', async (req, res) => {
  try {
    const { groupId, memberAddress } = req.params;
    const { adminAddress } = req.body;

    console.log('📝 Remove member request:', { groupId, memberAddress, adminAddress });

    if (!adminAddress) {
      return res.status(400).json({ error: 'adminAddress is required' });
    }

    // Debug: Check group data before operation
    const group = await db.getGroup(groupId);
    console.log('📝 Group data:', group ? {
      _id: group._id?.toString(),
      group_id: group.group_id,
      created_by: group.created_by,
      admins: group.admins,
      participantCount: group.participants?.length
    } : 'NOT FOUND');

    const success = await db.removeGroupMember(groupId, memberAddress, adminAddress);

    if (success) {
      res.json({ success: true, message: 'Member removed successfully' });
    } else {
      console.error('❌ Remove member failed - not authorized or cannot remove this member');
      res.status(403).json({ success: false, error: 'Not authorized or cannot remove this member' });
    }
  } catch (error) {
    console.error('Error removing group member:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Add admin to group
app.post('/api/groups/:groupId/admins', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { memberAddress, adminAddress } = req.body;

    console.log('📝 Add admin request:', { groupId, memberAddress, adminAddress });

    if (!memberAddress || !adminAddress) {
      return res.status(400).json({ error: 'memberAddress and adminAddress are required' });
    }

    // Debug: Check group data before operation
    const group = await db.getGroup(groupId);
    console.log('📝 Group data:', group ? {
      _id: group._id?.toString(),
      group_id: group.group_id,
      created_by: group.created_by,
      admins: group.admins,
      participantCount: group.participants?.length
    } : 'NOT FOUND');

    const success = await db.addGroupAdmin(groupId, memberAddress, adminAddress);

    if (success) {
      res.json({ success: true, message: 'Admin added successfully' });
    } else {
      console.error('❌ Add admin failed - not authorized or member not in group');
      res.status(403).json({ success: false, error: 'Not authorized or member not in group' });
    }
  } catch (error) {
    console.error('Error adding group admin:', error);
    res.status(500).json({ error: 'Failed to add admin' });
  }
});

// Remove admin from group
app.delete('/api/groups/:groupId/admins', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { memberAddress, adminAddress } = req.body;

    console.log('📝 Remove admin request:', { groupId, memberAddress, adminAddress });

    if (!memberAddress || !adminAddress) {
      return res.status(400).json({ error: 'memberAddress and adminAddress are required' });
    }

    // Debug: Check group data before operation
    const group = await db.getGroup(groupId);
    console.log('📝 Group data:', group ? {
      _id: group._id?.toString(),
      group_id: group.group_id,
      created_by: group.created_by,
      admins: group.admins,
      participantCount: group.participants?.length
    } : 'NOT FOUND');

    const success = await db.removeGroupAdmin(groupId, memberAddress, adminAddress);

    if (success) {
      res.json({ success: true, message: 'Admin removed successfully' });
    } else {
      console.error('❌ Remove admin failed - not authorized or cannot remove creator admin');
      res.status(403).json({ success: false, error: 'Not authorized or cannot remove creator admin' });
    }
  } catch (error) {
    console.error('Error removing group admin:', error);
    res.status(500).json({ error: 'Failed to remove admin' });
  }
});

// Get group members
app.get('/api/groups/:groupId/members', async (req, res) => {
  try {
    const { groupId } = req.params;

    const members = await db.getGroupMembers(groupId);

    res.json({ success: true, members });
  } catch (error) {
    console.error('Error getting group members:', error);
    res.status(500).json({ error: 'Failed to get members' });
  }
});

// Debug endpoint - get full group data
app.get('/api/groups/:groupId/debug', async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await db.getGroup(groupId);

    if (!group) {
      return res.status(404).json({ error: 'Group not found', groupId });
    }

    res.json({
      success: true,
      group: {
        _id: group._id?.toString(),
        group_id: group.group_id,
        name: group.name,
        created_by: group.created_by,
        admins: group.admins,
        participants: group.participants,
        type: group.type,
      }
    });
  } catch (error) {
    console.error('Error getting group debug info:', error);
    res.status(500).json({ error: 'Failed to get group' });
  }
});

// Fix a group that's missing created_by/admins
app.post('/api/groups/:groupId/fix', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const result = await db.fixGroup(groupId, walletAddress);

    if (!result.success) {
      return res.status(404).json({ error: 'Group not found or user is not a participant' });
    }

    res.json({
      success: true,
      message: 'Group fixed',
      updated: result.updated,
      group: {
        group_id: result.group?.group_id,
        created_by: result.group?.created_by,
        admins: result.group?.admins,
      }
    });
  } catch (error) {
    console.error('Error fixing group:', error);
    res.status(500).json({ error: 'Failed to fix group' });
  }
});

// Update group avatar
app.put('/api/groups/:groupId/avatar', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { avatarUrl, adminAddress } = req.body;

    if (!avatarUrl || !adminAddress) {
      return res.status(400).json({ error: 'avatarUrl and adminAddress are required' });
    }

    // Verify admin status
    const group = await db.getGroup(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const isAdmin = group.admins?.includes(adminAddress.toLowerCase()) ||
      group.created_by?.toLowerCase() === adminAddress.toLowerCase();

    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins can update group avatar' });
    }

    // Update the group avatar
    await db.updateGroupAvatar(groupId, avatarUrl);

    res.json({ success: true, avatarUrl });
  } catch (error) {
    console.error('Error updating group avatar:', error);
    res.status(500).json({ error: 'Failed to update group avatar' });
  }
});

// ============================================
// CONTACTS API
// ============================================

// Get all contacts for a user
app.get('/api/contacts/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const normalizedAddress = walletAddress.toLowerCase();

    const contacts = await db.getContacts(normalizedAddress);

    res.json({ success: true, contacts });
  } catch (error) {
    console.error('Error getting contacts:', error);
    res.status(500).json({ error: 'Failed to get contacts' });
  }
});

// Add a new contact
app.post('/api/contacts', async (req, res) => {
  try {
    const { ownerWallet, contactWallet, nickname } = req.body;

    if (!ownerWallet || !contactWallet) {
      return res.status(400).json({ error: 'ownerWallet and contactWallet are required' });
    }

    const contact = await db.addContact(ownerWallet, contactWallet, nickname);

    if (!contact) {
      return res.status(409).json({ error: 'Contact already exists or invalid' });
    }

    res.json({ success: true, contact });
  } catch (error) {
    console.error('Error adding contact:', error);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

// Update a contact (nickname, favorite status)
app.put('/api/contacts/:ownerWallet/:contactWallet', async (req, res) => {
  try {
    const { ownerWallet, contactWallet } = req.params;
    const { nickname, isFavorite } = req.body;

    const updates: { nickname?: string; is_favorite?: boolean } = {};
    if (nickname !== undefined) updates.nickname = nickname;
    if (isFavorite !== undefined) updates.is_favorite = isFavorite;

    const success = await db.updateContact(ownerWallet, contactWallet, updates);

    if (!success) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating contact:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// Remove a contact
app.delete('/api/contacts/:ownerWallet/:contactWallet', async (req, res) => {
  try {
    const { ownerWallet, contactWallet } = req.params;

    const success = await db.removeContact(ownerWallet, contactWallet);

    if (!success) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing contact:', error);
    res.status(500).json({ error: 'Failed to remove contact' });
  }
});

// Check if contact exists
app.get('/api/contacts/:ownerWallet/:contactWallet/exists', async (req, res) => {
  try {
    const { ownerWallet, contactWallet } = req.params;

    const exists = await db.isContactExists(ownerWallet, contactWallet);

    res.json({ success: true, exists });
  } catch (error) {
    console.error('Error checking contact:', error);
    res.status(500).json({ error: 'Failed to check contact' });
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
        const messageData: any = {
          // Use client_id if available, otherwise fall back to MongoDB _id
          id: msg.client_id || msg._id?.toString(),
          senderId: msg.sender_wallet,
          recipientId: msg.recipient_wallet,
          content: msg.content,
          timestamp: new Date(msg.created_at).getTime(),
          type: msg.message_type,
        };

        // Include conversation ID if available
        if (msg.conversation_id) {
          messageData.conversationId = msg.conversation_id;
        }

        // Include group info if this is a group message
        if (msg.group_info) {
          messageData.groupInfo = msg.group_info;
        }

        socket.emit('message', messageData);
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
            message.id,  // Pass client-generated ID for read receipt tracking
            conversationId || undefined  // Include conversation ID
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
  // Message Reactions
  // ----------------------

  socket.on('message:reaction', async ({ messageId, emoji, conversationId, userId }: {
    messageId: string;
    emoji: string;
    conversationId: string;
    userId: string;
  }) => {
    try {
      console.log('Reaction:', { messageId, emoji, userId });

      // Toggle reaction in database (add or remove)
      const { action, reactions } = await db.toggleMessageReaction(messageId, emoji, userId);

      // Get conversation to find participants
      const conversation = await db.getConversationById(conversationId);
      if (!conversation) {
        console.log('Conversation not found for reaction');
        return;
      }

      // Broadcast to all participants (including sender for confirmation)
      for (const participant of conversation.participants) {
        const participantSocketId = activeConnections.get(participant.toLowerCase());
        if (participantSocketId) {
          io.to(participantSocketId).emit('message:reaction', {
            messageId,
            emoji,
            userId,
            action,
            reactions, // Send full reactions list for sync
          });
        }
      }
    } catch (error) {
      console.error('Error handling message:reaction:', error);
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

  socket.on('call:initiate', async ({ recipientAddress, callType, offer, callId, callerName }: any) => {
    try {
      const recipient = recipientAddress.toLowerCase();
      const recipientSocketId = activeConnections.get(recipient);
      const finalCallId = callId || `${address}-${recipient}-${Date.now()}`;

      console.log('Call initiated:', {
        from: address,
        to: recipient,
        callId: finalCallId,
        type: callType,
        recipientOnline: !!recipientSocketId
      });

      if (recipientSocketId) {
        // Recipient is online - send via WebSocket
        io.to(recipientSocketId).emit('call:incoming', {
          callerId: address,
          callerName: callerName, // Pass caller's @name
          callType,
          offer,
          callId: finalCallId,
        });

        // Confirm call initiated to caller with the SAME call ID
        socket.emit('call:initiated', { callId: finalCallId, recipientAddress: recipient });
      } else {
        // Recipient is OFFLINE - try to send push notification
        console.log(`📞 Recipient ${recipient} is offline, attempting push notification...`);

        // Get caller's profile for display name
        let displayName = callerName;
        if (!displayName) {
          try {
            const callerProfile = await db.getUserByWallet(address);
            displayName = callerProfile?.username || truncateAddress(address);
          } catch {
            displayName = truncateAddress(address);
          }
        }

        console.log("recipient", recipient)
        console.log("finalCallId", finalCallId)
        console.log("address", address)
        console.log("displayName", displayName)
        console.log("callType", callType)

        // Send push notification
        const pushSent = await sendCallPushNotification(
          recipient,
          finalCallId,
          address,
          displayName,
          callType
        );

        if (pushSent) {
          console.log(`📞 Push notification sent for call ${finalCallId}`);
          // Tell the caller we're trying to reach them via push
          socket.emit('call:initiated', {
            callId: finalCallId,
            recipientAddress: recipient,
            viaPush: true // Indicate this went via push, not direct socket
          });
        } else {
          // No push tokens or push failed
          socket.emit('call:unavailable', {
            recipientAddress: recipient,
            reason: 'User is offline and push notifications unavailable',
          });
        }
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
      // Log what we received from frontend
      console.log('📥 group:create received from frontend:', JSON.stringify({
        id: group?.id,
        groupName: group?.groupName,
        createdBy: group?.createdBy,
        admins: group?.admins,
        participants: group?.participants,
        members: members,
      }, null, 2));

      // Ensure createdBy and admins are set if not provided
      if (!group.createdBy) {
        console.log('⚠️ group.createdBy was not set, using socket address:', address);
        group.createdBy = address;
      }
      if (!group.admins || group.admins.length === 0) {
        console.log('⚠️ group.admins was empty, setting to createdBy:', group.createdBy);
        group.admins = [group.createdBy];
      }

      // Save the group to database
      await db.createGroupConversation(group);
      console.log(`📢 Group "${group.groupName}" created by ${address} with members:`, members);

      // Notify all members about the new group
      for (const memberAddress of members) {
        const memberLower = memberAddress.toLowerCase();
        if (memberLower === address) continue; // Skip creator

        const memberSocketId = activeConnections.get(memberLower);
        if (memberSocketId) {
          // Member is online - send immediately
          io.to(memberSocketId).emit('group:created', { group, createdBy: address });
        } else {
          // Member is offline - queue a system message that will trigger group creation
          // We use a special message type 'group:invite' that the frontend will handle
          await db.queueOfflineMessage(
            memberLower,
            address,
            JSON.stringify({ type: 'group:created', group, createdBy: address }),
            'system:group_invite',
            `group_invite_${group.id}_${memberLower}`,
            group.id,
            {
              id: group.id,
              groupName: group.groupName,
              participants: group.participants,
              admins: group.admins,
              createdBy: group.createdBy,
              groupAvatar: group.groupAvatar,
            }
          );
          console.log(`   → Queued group invite for offline member ${memberLower}`);
        }
      }
    } catch (error) {
      console.error('Error creating group:', error);
    }
  });

  socket.on('group:message', async ({ groupId, message, recipients, groupInfo }: any) => {
    try {
      console.log(`📢 Group message in ${groupId} from ${address}:`, message.content?.substring(0, 30));

      // For encrypted group messages, we store a marker and send individual payloads
      const isEncrypted = message.content === '__ENCRYPTED_GROUP__' && message.encryptedPayloads;

      // Save message to database (store encrypted marker or plain text)
      await db.saveMessage(
        groupId,
        address,
        message.content,
        message.type || 'text',
        message.id,
        isEncrypted ? message.encryptedPayloads : undefined // Store encrypted payloads
      );

      // Forward to all recipients with their specific encrypted content
      for (const recipientAddress of recipients) {
        const recipientLower = recipientAddress.toLowerCase();
        const recipientSocketId = activeConnections.get(recipientLower);

        // Get the recipient's specific encrypted payload
        let recipientContent = message.content;
        if (isEncrypted && message.encryptedPayloads[recipientLower]) {
          recipientContent = message.encryptedPayloads[recipientLower];
        }

        const recipientMessage = {
          ...message,
          content: recipientContent,
          conversationId: groupId,
          senderId: address,
          encryptedPayloads: undefined, // Don't send all payloads to each recipient
          groupInfo, // Include group metadata so recipient can create group if needed
        };

        if (recipientSocketId) {
          io.to(recipientSocketId).emit('message', recipientMessage);
          console.log(`   → Sent to ${recipientAddress} (encrypted: ${isEncrypted})`);
        } else {
          // Queue for offline delivery with their specific encrypted content
          await db.queueOfflineMessage(
            recipientAddress,
            address,  // sender wallet
            recipientContent,  // their encrypted content
            message.type || 'text',
            message.id,  // client ID
            groupId,  // conversation ID
            groupInfo  // group metadata
          );
          console.log(`   → Queued offline for ${recipientAddress}`);
        }
      }

      console.log(`✅ Group message delivered to ${recipients.length} recipients`);
    } catch (error) {
      console.error('Error handling group message:', error);
    }
  });

  // ----------------------
  // Group Member Management Events
  // ----------------------

  socket.on('group:member:add', async ({ groupId, memberAddress, addedBy, groupName }: any) => {
    try {
      console.log(`📢 Adding member ${memberAddress} to group ${groupId}`);

      // Notify the added member
      const memberSocketId = activeConnections.get(memberAddress.toLowerCase());
      if (memberSocketId) {
        io.to(memberSocketId).emit('group:member:added', {
          groupId,
          memberAddress: memberAddress.toLowerCase(),
          addedBy: addedBy.toLowerCase(),
          groupName,
        });
        console.log(`   → Notified ${memberAddress} they were added`);
      }

      // Also notify existing members
      const members = await db.getGroupMembers(groupId);
      for (const member of members) {
        if (member.toLowerCase() !== address && member.toLowerCase() !== memberAddress.toLowerCase()) {
          const socketId = activeConnections.get(member.toLowerCase());
          if (socketId) {
            io.to(socketId).emit('group:member:added', {
              groupId,
              memberAddress: memberAddress.toLowerCase(),
              addedBy: addedBy.toLowerCase(),
            });
          }
        }
      }
    } catch (error) {
      console.error('Error handling group:member:add:', error);
    }
  });

  socket.on('group:member:remove', async ({ groupId, memberAddress, removedBy }: any) => {
    try {
      console.log(`📢 Removing member ${memberAddress} from group ${groupId}`);

      // Notify the removed member
      const memberSocketId = activeConnections.get(memberAddress.toLowerCase());
      if (memberSocketId) {
        io.to(memberSocketId).emit('group:member:removed', {
          groupId,
          memberAddress: memberAddress.toLowerCase(),
          removedBy: removedBy.toLowerCase(),
        });
        console.log(`   → Notified ${memberAddress} they were removed`);
      }

      // Notify remaining members
      const members = await db.getGroupMembers(groupId);
      for (const member of members) {
        if (member.toLowerCase() !== address) {
          const socketId = activeConnections.get(member.toLowerCase());
          if (socketId) {
            io.to(socketId).emit('group:member:removed', {
              groupId,
              memberAddress: memberAddress.toLowerCase(),
              removedBy: removedBy.toLowerCase(),
            });
          }
        }
      }
    } catch (error) {
      console.error('Error handling group:member:remove:', error);
    }
  });

  // Handle group avatar updates
  socket.on('group:avatar:update', async ({ groupId, avatarUrl, updatedBy }: any) => {
    try {
      console.log(`🖼️ Updating avatar for group ${groupId}`);

      // Notify all group members
      const members = await db.getGroupMembers(groupId);
      for (const member of members) {
        if (member.toLowerCase() !== address) {
          const socketId = activeConnections.get(member.toLowerCase());
          if (socketId) {
            io.to(socketId).emit('group:avatar:updated', {
              groupId,
              avatarUrl,
              updatedBy: updatedBy?.toLowerCase(),
            });
          }
        }
      }
    } catch (error) {
      console.error('Error handling group:avatar:update:', error);
    }
  });

  // ----------------------
  // Group Call Events
  // ----------------------

  socket.on('group:call:initiate', ({ recipientAddress, callType, offer, callId, groupId, groupName, participants }: any) => {
    try {
      const recipient = recipientAddress.toLowerCase();
      const recipientSocketId = activeConnections.get(recipient);

      console.log('Group call initiated:', {
        from: address,
        to: recipient,
        callId,
        groupId,
        groupName,
        type: callType
      });

      if (recipientSocketId) {
        io.to(recipientSocketId).emit('group:call:incoming', {
          callerId: address,
          callerAddress: address,
          callType,
          offer,
          callId,
          groupId,
          groupName,
          participants,
          peerId: `${callId}-${recipient}`,
        });

        console.log(`   → Group call signal sent to ${recipient}`);
      } else {
        console.log(`   → ${recipient} is offline, cannot reach`);
        socket.emit('group:call:participant:unavailable', {
          address: recipient,
          callId,
        });
      }
    } catch (error) {
      console.error('Error initiating group call:', error);
    }
  });

  socket.on('group:call:answer', ({ callId, answer, peerId, toAddress }: any) => {
    try {
      // Extract caller address from callId (format: groupId-timestamp)
      // The toAddress should be the caller
      const recipientSocketId = activeConnections.get(toAddress.toLowerCase());

      console.log('Group call answer:', { callId, peerId, toAddress, hasSocket: !!recipientSocketId });

      if (recipientSocketId) {
        io.to(recipientSocketId).emit('group:call:answer', {
          callId,
          answer,
          peerId,
          fromAddress: address,
        });
        console.log(`   → Group call answer sent to ${toAddress}`);
      }
    } catch (error) {
      console.error('Error answering group call:', error);
    }
  });

  socket.on('group:call:ice-candidate', ({ recipientAddress, candidate, callId, peerId }: any) => {
    try {
      const recipient = recipientAddress.toLowerCase();
      const recipientSocketId = activeConnections.get(recipient);

      if (recipientSocketId) {
        console.log(`Relaying group call ICE candidate from ${address} to ${recipient}`);
        io.to(recipientSocketId).emit('group:call:ice-candidate', {
          from: address,
          candidate,
          callId,
          peerId,
        });
      }
    } catch (error) {
      console.error('Error handling group call ICE candidate:', error);
    }
  });

  socket.on('group:call:end', async ({ callId, groupId }: any) => {
    try {
      console.log(`Group call ended: ${callId} in group ${groupId}`);

      // Get all group members and notify them
      const members = await db.getGroupMembers(groupId);
      for (const member of members) {
        if (member.toLowerCase() !== address) {
          const socketId = activeConnections.get(member.toLowerCase());
          if (socketId) {
            io.to(socketId).emit('group:call:ended', { callId, endedBy: address });
          }
        }
      }
    } catch (error) {
      console.error('Error ending group call:', error);
    }
  });

  socket.on('group:call:leave', async ({ callId, groupId }: any) => {
    try {
      console.log(`User ${address} left group call: ${callId}`);

      // Notify other participants
      const members = await db.getGroupMembers(groupId);
      for (const member of members) {
        if (member.toLowerCase() !== address) {
          const socketId = activeConnections.get(member.toLowerCase());
          if (socketId) {
            io.to(socketId).emit('group:call:participant:left', {
              callId,
              address,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error handling group call leave:', error);
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
      lastSeenTimes.set(address, Date.now()); // Track last seen time

      // Broadcast offline status with last seen
      socket.broadcast.emit('user:status', {
        address,
        status: 'offline',
        lastSeen: Date.now(),
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

    // Initialize Firebase for push notifications
    const firebaseInitialized = pushService.initializePushServices();

    httpServer.listen(PORT, () => {
      console.log('');
      console.log('══════════════════════════════════════════════════════════════');
      console.log(`🚀 BlockStar Cypher Server running on port ${PORT}`);
      console.log('══════════════════════════════════════════════════════════════');
      console.log('');
      console.log('📦 Database:', dbInitialized ? 'Connected (MongoDB)' : 'NOT CONNECTED');
      console.log('📱 Push Notifications:', firebaseInitialized ? 'Enabled (Firebase)' : 'DISABLED');
      console.log('');
      console.log('🔗 Endpoints:');
      console.log(`   Health check: http://localhost:${PORT}/health`);
      console.log(`   Key registration: POST http://localhost:${PORT}/api/keys/register`);
      console.log(`   Get user key: GET http://localhost:${PORT}/api/keys/:address`);
      console.log(`   Push token: POST/DELETE http://localhost:${PORT}/api/push-token`);
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
