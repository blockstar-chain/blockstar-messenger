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
import callTokenService from './services/callTokenService';



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

// ═══════════════════════════════════════════════════════════════
// Debug logging endpoint - receives logs from mobile apps
// ═══════════════════════════════════════════════════════════════
app.post('/api/debug-log', (req, res) => {
  const { message, extra, timestamp, platform, source } = req.body;

  // console.log('');
  // console.log('📱═══════════════════════════════════════════════════════');
  // console.log(`📱 MOBILE DEBUG [${platform || 'unknown'}] ${source ? `(${source})` : ''}`);
  // console.log(`📱 Time: ${timestamp || new Date().toISOString()}`);
  // console.log('📱───────────────────────────────────────────────────────');
  // console.log(`📱 ${message}`);
  // if (extra) {
  //   console.log('📱 Extra:', extra);
  // }
  // console.log('📱═══════════════════════════════════════════════════════');
  // console.log('');

  res.status(200).json({ success: true });
});


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

// app.get('/test-push', async (req, res) => {
//   let recipient = "0xf93389abc18a6acdea5127c727e350bdf7f81156"
//   let finalCallId = "0xad5292d3d35f57cc0d7876cfd7b583dc99637b0d-0xf93389abc18a6acdea5127c727e350bdf7f81156-1765169684666"
//   let address = "0xad5292d3d35f57cc0d7876cfd7b583dc99637b0d"
//   let displayName = "blockstardev"
//   let callType = "audio"
//   const pushSent = await sendCallPushNotification(
//     recipient,
//     finalCallId,
//     address,
//     displayName,
//     callType
//   );

//   console.log(pushSent)
// })

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
// ============================================
// TURN CREDENTIALS (for calls behind strict NAT / office & home Wi-Fi)
// ============================================
// Uses coturn's "use-auth-secret" (TURN REST API): short-lived credentials
// derived from a shared secret, so nothing long-lived ships in the frontend.
//   TURN_SECRET = same value as `static-auth-secret` in turnserver.conf
//   TURN_URLS   = comma-separated, e.g.
//     turn:turn.blockstar.world:3478?transport=udp,turn:turn.blockstar.world:3478?transport=tcp,turns:turn.blockstar.world:5349?transport=tcp
app.get('/api/turn-credentials', (req, res) => {
  const secret = process.env.TURN_SECRET;
  const urls = (process.env.TURN_URLS || '').split(',').map(u => u.trim()).filter(Boolean);
  if (!secret || urls.length === 0) {
    return res.json({ success: true, iceServers: [], ttl: 0, configured: false });
  }
  const ttl = 12 * 60 * 60; // 12h
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const who = String(req.query.wallet || 'cypher').toLowerCase().replace(/[^a-z0-9x]/g, '').slice(0, 42) || 'cypher';
  const username = `${expiry}:${who}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, iceServers: [{ urls, username, credential }], ttl, configured: true });
});

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

    const firebaseReady = pushService.firebaseInitialized ? true : false;

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

app.post('/api/calls/verify-token', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token is required'
      });
    }

    const callData = callTokenService.verifyCallToken(token);

    if (!callData) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // Get additional user info
    const recipient = await db.getUserByWallet(callData.recipientWallet);

    res.json({
      success: true,
      callId: callData.callId,
      callerId: callData.callerId,
      callerName: callData.callerName,
      callType: callData.callType,
      recipientWallet: callData.recipientWallet,
      // Include recipient's user data for the session
      user: recipient ? {
        walletAddress: recipient.wallet_address,
        username: recipient.username,
      } : null
    });

  } catch (error) {
    console.error('Error verifying call token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify token'
    });
  }
});

// Get call offer - used by mobile /call page after answering
app.get('/api/calls/:callId/offer', async (req, res) => {
  try {
    const { callId } = req.params;
    const { token } = req.query;

    if (!callId) {
      return res.status(400).json({
        success: false,
        error: 'Call ID is required'
      });
    }

    // Optional: verify token for additional security
    if (token) {
      const callData = callTokenService.verifyCallToken(token as string);
      if (!callData || callData.callId !== callId) {
        return res.status(401).json({
          success: false,
          error: 'Invalid token for this call'
        });
      }
    }

    const offer = callTokenService.getCallOffer(callId);

    if (!offer) {
      return res.status(404).json({
        success: false,
        error: 'Call offer not found or expired'
      });
    }

    res.json({
      success: true,
      offer,
    });

  } catch (error) {
    console.error('Error getting call offer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get call offer'
    });
  }
});

// Get pending call info (without token, just by callId - for checking if call still active)
app.get('/api/calls/:callId/status', async (req, res) => {
  try {
    const { callId } = req.params;

    const pendingCall = callTokenService.getPendingCall(callId);

    if (!pendingCall) {
      return res.json({
        success: true,
        active: false,
        reason: 'Call not found or expired'
      });
    }

    res.json({
      success: true,
      active: true,
      callType: pendingCall.callType,
      hasOffer: !!pendingCall.offer,
    });

  } catch (error) {
    console.error('Error getting call status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get call status'
    });
  }
});



// Send call-specific push notification (high priority)
// ============================================
// REACH-AWARE EMIT
// ============================================
// A mobile app that's backgrounded / locked keeps its socket "connected" from
// the server's point of view for up to ~45s (ping timeout), but iOS has frozen
// the JS — anything emitted to it just vanishes. So for things the user must
// notice (messages, calls) we emit WITH an ack: the client replies immediately
// with { visible }. No reply in time, or app not on screen ⇒ send a push too.
type Reach =
  | { status: 'offline' }
  | { status: 'no-ack' }
  | { status: 'delivered'; visible: boolean };

function emitWithReach(walletAddress: string, event: string, payload: any, timeoutMs = 4000): Promise<Reach> {
  const socketId = activeConnections.get(walletAddress.toLowerCase());
  const target = socketId ? io.sockets.sockets.get(socketId) : undefined;
  if (!target) return Promise.resolve({ status: 'offline' });

  return new Promise<Reach>((resolve) => {
    target.timeout(timeoutMs).emit(event, payload, (err: any, response: any) => {
      if (err) {
        console.log(`   ⏱️ No ack for ${event} from ${walletAddress} — treating as unreachable`);
        resolve({ status: 'no-ack' });
      } else {
        resolve({ status: 'delivered', visible: response?.visible !== false });
      }
    });
  });
}

/** Generic message push — NEVER includes message content (E2E). */
async function sendMessagePush(
  recipientWallet: string,
  senderWallet: string,
  senderNameHint: string | undefined,
  body: string,
  conversationId: string
): Promise<void> {
  try {
    const tokens = await db.getPushTokens(recipientWallet.toLowerCase());
    if (!tokens || !tokens.length) return;
    const recipientNickname = await db.getContactNickname(recipientWallet.toLowerCase(), senderWallet);
    const senderName = recipientNickname || senderNameHint ||
      `${senderWallet.slice(0, 6)}…${senderWallet.slice(-4)}`;
    for (const { push_token, platform } of tokens) {
      try {
        await pushService.sendMessageNotification(
          push_token,
          platform as 'ios' | 'android',
          senderName,
          body,
          conversationId
        );
      } catch (err) {
        console.error(`Failed to send message push to ${platform}:`, err);
      }
    }
    console.log(`📬 Message push sent to ${tokens.length} device(s) for ${recipientWallet}`);
  } catch (err) {
    console.error('Failed to send message push:', err);
  }
}

// ============================================
// GROUP CALL STATE
// ============================================
// Group calls are a star: the initiator holds one peer connection per member.
// We track each call so we can (a) push members whose phones are asleep,
// (b) re-deliver the ring when they open the app, and (c) end/leave properly.
interface GroupCallState {
  callId: string;
  groupId: string;
  groupName: string;
  callType: 'audio' | 'video';
  initiator: string;
  initiatorName?: string;
  participants: string[];
  offers: Map<string, any>;        // recipient -> initiator's offer for them
  pending: Map<string, number>;    // recipient -> time we started ringing
  pushed: Set<string>;             // recipients we've already pushed
  joined: Set<string>;
  createdAt: number;
}
const groupCalls = new Map<string, GroupCallState>();
const GROUP_RING_TTL_MS = 60_000;           // stop ringing a member after 60s
const GROUP_CALL_MAX_AGE_MS = 6 * 60 * 60_000;

function groupIncomingPayload(call: GroupCallState, recipient: string) {
  return {
    callerId: call.initiator,
    callerAddress: call.initiator,
    initiatorId: call.initiator,
    callerName: call.initiatorName,
    callType: call.callType,
    offer: call.offers.get(recipient),
    callId: call.callId,
    groupId: call.groupId,
    groupName: call.groupName,
    participants: call.participants,
    peerId: `${call.callId}-${recipient}`,
  };
}

async function pushGroupCall(call: GroupCallState, recipient: string): Promise<void> {
  if (call.pushed.has(recipient)) return;
  call.pushed.add(recipient);
  try {
    const tokens = await db.getPushTokens(recipient);
    if (!tokens || !tokens.length) {
      console.log(`   📱 No push tokens for ${recipient} — can't ring group call`);
      return;
    }
    const nickname = await db.getContactNickname(recipient, call.initiator).catch(() => null);
    for (const { push_token, platform } of tokens) {
      try {
        await pushService.sendGroupCallNotification(push_token, platform as 'ios' | 'android', {
          callId: call.callId,
          groupId: call.groupId,
          groupName: call.groupName,
          callerName: nickname || call.initiatorName || truncateAddress(call.initiator),
          callType: call.callType,
        });
      } catch (err) {
        console.error(`Failed group call push to ${platform}:`, err);
      }
    }
    console.log(`   📞 Group call push sent to ${recipient} (${tokens.length} device(s))`);
  } catch (err) {
    console.error('Group call push failed:', err);
  }
}

/** Ring one member: socket first; push if their app isn't on screen. */
function ringGroupMember(call: GroupCallState, recipient: string): void {
  emitWithReach(recipient, 'group:call:incoming', groupIncomingPayload(call, recipient)).then(async (reach) => {
    if (reach.status === 'delivered' && reach.visible) {
      console.log(`   → Group call ringing on ${recipient}`);
      return;
    }
    console.log(`   → ${recipient} not on screen (${reach.status}) — pushing group call`);
    await pushGroupCall(call, recipient);
  }).catch((err) => console.error('ringGroupMember failed:', err));
}

/** Re-send any still-ringing group calls to this user (on connect / app foreground). */
function resyncPendingCalls(walletAddress: string): void {
  const me = walletAddress.toLowerCase();
  const now = Date.now();
  for (const call of groupCalls.values()) {
    const since = call.pending.get(me);
    if (since === undefined) continue;
    if (now - since > GROUP_RING_TTL_MS) { call.pending.delete(me); continue; }
    const socketId = activeConnections.get(me);
    if (socketId) {
      console.log(`📞 Re-delivering pending group call ${call.callId} to ${me}`);
      io.to(socketId).emit('group:call:incoming', groupIncomingPayload(call, me));
    }
  }
}

function emitToUser(walletAddress: string, event: string, payload: any): void {
  const socketId = activeConnections.get(walletAddress.toLowerCase());
  if (socketId) io.to(socketId).emit(event, payload);
}

// Housekeeping: expire stale rings and abandoned calls
setInterval(() => {
  const now = Date.now();
  for (const [callId, call] of groupCalls) {
    for (const [member, since] of call.pending) {
      if (now - since > GROUP_RING_TTL_MS) {
        call.pending.delete(member);
        emitToUser(call.initiator, 'group:call:participant:unavailable', { callId, address: member });
      }
    }
    if (now - call.createdAt > GROUP_CALL_MAX_AGE_MS) groupCalls.delete(callId);
  }
}, 15_000);

async function sendCallPushNotification(
  recipientWallet: string,
  callId: string,
  callerId: string,
  callerName: string | undefined,
  callType: 'audio' | 'video',
  offer?: any  // WebRTC offer to store for later retrieval
): Promise<boolean> {
  try {
    console.log('hererere inside sendCallPushNotification')
    const tokens = await db.getPushTokens(recipientWallet);
    console.log(tokens)
    if (tokens.length === 0) {
      console.log(`📱 No push tokens for ${recipientWallet.substring(0, 10)}... - cannot send call notification`);
      return false;
    }

    console.log("here 1")

    console.log(`📞 Sending call notification to ${tokens.length} device(s)`);

    // ═══════════════════════════════════════════════════════════════
    // Generate auth token and store call data
    // ═══════════════════════════════════════════════════════════════
    const authToken = callTokenService.createPendingCall(
      callId,
      callerId,
      callerName,
      callType,
      recipientWallet,
      offer  // Store the offer for later retrieval
    );

    // Generate the deep link URL
    const frontendUrl = process.env.FRONTEND_URL || 'https://messenger.blockstar.world';
    const callUrl = `${frontendUrl}/call?callId=${encodeURIComponent(callId)}&callerId=${encodeURIComponent(callerId)}&callerName=${encodeURIComponent(callerName || '')}&callType=${callType}&token=${authToken}`;

    console.log(`📞 Call deep link generated: ${callUrl}`);

    let sent = false;
    for (const { push_token, platform } of tokens) {
      try {
        // Use new function that includes deep link
        const success = await pushService.sendCallNotificationWithDeepLink(
          push_token,
          platform as 'ios' | 'android',
          {
            callId,
            callerId,
            callerName,
            callType,
          },
          authToken,
          callUrl
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

// Send missed call push notification
async function sendMissedCallPushNotification(
  recipientWallet: string,
  callerId: string,
  callerName: string,
  callType: 'audio' | 'video'
): Promise<boolean> {
  try {
    const tokens = await db.getPushTokens(recipientWallet);

    if (tokens.length === 0) {
      console.log(`📱 No push tokens for ${recipientWallet.substring(0, 10)}... - cannot send missed call notification`);
      return false;
    }

    console.log(`📞 Sending missed call notification to ${tokens.length} device(s)`);

    let sent = false;
    for (const { push_token, platform } of tokens) {
      try {
        const success = await pushService.sendFCMPush(
          push_token,
          {
            title: `Missed ${callType} call`,
            body: `You missed a ${callType} call from ${callerName}`,
            data: {
              type: 'missed_call',
              callerId,
              callerName,
              callType,
            },
            sound: 'default',
          },
          platform as 'ios' | 'android'
        );
        if (success) sent = true;
      } catch (err) {
        console.error(`Failed to send missed call push to ${platform}:`, err);
      }
    }

    return sent;
  } catch (error) {
    console.error('Error sending missed call push notification:', error);
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
      // Return 200 with null publicKey instead of 404
      // This prevents console errors for users who haven't registered yet
      return res.json({
        success: true,
        walletAddress: walletAddress.toLowerCase(),
        publicKey: null,
        username: null,
        isOnline: false,
        status: 'unknown',
        registered: false
      });
    }

    res.json({
      success: true,
      walletAddress: user.wallet_address,
      publicKey: user.public_key,
      username: user.username,
      isOnline: activeConnections.has(walletAddress.toLowerCase()),
      status: userStatuses.get(walletAddress.toLowerCase()) || user.status || 'offline',
      registered: true
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
      // V3: Pass full username (with TLD) so resolver can extract name + tld
      profile = await profileResolver.resolveProfile(username);
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
    // V3: Pass full usernames (with TLD) so resolver can extract name + tld
    const profiles = await profileResolver.resolveProfiles(usernames);

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
      // V3: Pass full usernames (with TLD) so resolver can extract name + tld
      const profiles = await profileResolver.resolveProfiles(usernames);

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
            fullUsername: user.username.includes('@') ? user.username : `${user.username}@${process.env.DEFAULT_TLD || 'bst'}`,
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

    let conversations = await db.getUserConversations(address);

    // Filter out invalid groups (groups without proper names)
    // These are phantom groups created by bugs - they should not be returned
    const beforeFilter = conversations.length;
    const invalidGroupIds: string[] = [];

    conversations = conversations.filter(c => {
      if (c.type === 'group') {
        const name = c.name || '';
        // Skip groups with no name or default "Group Chat" name
        if (!name || name === 'Group Chat' || name.trim() === '') {
          const groupId = (c as any).group_id || c._id?.toString();
          console.log(`⚠️ Filtering out invalid group: ${groupId} (name: "${name}")`);
          if (groupId) {
            invalidGroupIds.push(groupId);
          }
          return false;
        }
      }
      return true;
    });

    if (beforeFilter !== conversations.length) {
      console.log(`🧹 Filtered out ${beforeFilter - conversations.length} invalid groups`);

      // PERMANENTLY DELETE invalid groups from database to stop them from appearing
      // This runs async in background - don't await to not slow down response
      if (invalidGroupIds.length > 0) {
        console.log(`🗑️ Scheduling deletion of ${invalidGroupIds.length} invalid groups: ${invalidGroupIds.join(', ')}`);

        // Delete in background
        (async () => {
          for (const groupId of invalidGroupIds) {
            try {
              await db.deleteConversation(groupId);
              console.log(`🗑️ Deleted invalid group: ${groupId}`);
            } catch (err) {
              console.error(`❌ Failed to delete invalid group ${groupId}:`, err);
            }
          }
        })();
      }
    }

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

    // REMOVED: Participant-based deduplication
    // Users should be able to have multiple groups with the same participants
    // Each group has a unique group_id and should be preserved

    // Enrich conversations with last message
    const enrichedConversations = await Promise.all(
      conversations.map(async (conv) => {
        // Cast to any to access group-specific fields
        const convAny = conv as any;

        // For groups, use group_id for messages; for direct, use _id
        const conversationId = convAny.group_id || conv._id!.toString();
        const messages = await db.getMessages(conversationId, 1);
        const lastMessage = messages.length > 0 ? messages[0] : null;

        // Process lastMessage content for encrypted group messages
        let lastMessageContent = lastMessage?.content;
        // For encrypted group messages, hand back THIS user's ciphertext so the
        // client can decrypt the preview locally (server still can't read it).
        let encryptedForMe: string | undefined;
        if (lastMessage && lastMessageContent === '__ENCRYPTED_GROUP__') {
          const msgAny = lastMessage as any;
          if (msgAny.encrypted_payloads && msgAny.encrypted_payloads[address]) {
            encryptedForMe = msgAny.encrypted_payloads[address];
          }
        }

        return {
          id: conversationId,  // Use group_id if available
          legacyId: convAny.group_id ? conv._id!.toString() : undefined,
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
            clientId: lastMessage.client_id,
            content: lastMessageContent,
            encryptedForMe,
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
        edited: msgAny.edited || false,
        editedAt: msgAny.edited_at ? new Date(msgAny.edited_at).getTime() : undefined,
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

// Edit a single message's content (used as a persistence fallback alongside
// the real-time message:edit socket event, mirroring the delete endpoint below)
app.patch('/api/messages/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content, encryptedPayloads } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const edited = await db.editMessage(messageId, content, encryptedPayloads);

    if (edited) {
      res.json({ success: true, message: 'Message edited' });
    } else {
      res.status(404).json({ success: false, error: 'Message not found' });
    }
  } catch (error) {
    console.error('Error editing message:', error);
    res.status(500).json({ error: 'Failed to edit message' });
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
// BLOCKING API
// ============================================

// List users blocked by walletAddress
app.get('/api/blocks/:walletAddress', async (req, res) => {
  try {
    const blocks = await db.getBlockedUsers(req.params.walletAddress);
    res.json({
      success: true,
      blocked: blocks.map(b => ({ walletAddress: b.blocked_wallet, blockedAt: b.created_at.getTime() })),
    });
  } catch (error) {
    console.error('Error getting blocked users:', error);
    res.status(500).json({ error: 'Failed to get blocked users' });
  }
});

// Block a user
app.post('/api/blocks', async (req, res) => {
  try {
    const { blockerWallet, blockedWallet } = req.body || {};
    if (!blockerWallet || !blockedWallet) {
      return res.status(400).json({ error: 'blockerWallet and blockedWallet are required' });
    }
    const ok = await db.blockUser(blockerWallet, blockedWallet);
    if (!ok) return res.status(400).json({ error: 'Invalid block request' });

    // If the blocked user is mid-ring with the blocker, nothing else to do here;
    // future messages/calls are filtered in the socket handlers.
    console.log(`🚫 ${blockerWallet.toLowerCase()} blocked ${blockedWallet.toLowerCase()}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error blocking user:', error);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// Unblock a user
app.delete('/api/blocks/:blockerWallet/:blockedWallet', async (req, res) => {
  try {
    const { blockerWallet, blockedWallet } = req.params;
    await db.unblockUser(blockerWallet, blockedWallet);
    console.log(`✅ ${blockerWallet.toLowerCase()} unblocked ${blockedWallet.toLowerCase()}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error unblocking user:', error);
    res.status(500).json({ error: 'Failed to unblock user' });
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
        const convAny = conv as any;
        // Groups are addressed by group_id everywhere else — returning the Mongo
        // _id here is what created the duplicate "Group Chat" on clients.
        const convId: string = convAny.group_id || conv._id!.toString();
        const messages = await db.getMessages(convId, 50);

        return {
          id: convId,
          legacyId: convAny.group_id ? conv._id!.toString() : undefined,
          type: conv.type,
          participants: conv.participants,
          name: conv.name,
          avatarUrl: conv.avatar_url,
          groupName: conv.type === 'group' ? conv.name : undefined,
          groupAvatar: conv.type === 'group' ? conv.avatar_url : undefined,
          admins: convAny.admins || [],
          createdBy: convAny.created_by || '',
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

            const msgAny = msg as any;
            // Encrypted group message: hand back THIS user's ciphertext
            if (contentStr === '__ENCRYPTED_GROUP__' && msgAny.encrypted_payloads?.[address]) {
              contentStr = msgAny.encrypted_payloads[address];
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
              edited: msgAny.edited || false,
              editedAt: msgAny.edited_at ? new Date(msgAny.edited_at).getTime() : undefined,
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

  // If a group call was ringing for this user while their app was asleep,
  // ring them now that they're back (small delay so client handlers attach).
  setTimeout(() => resyncPendingCalls(address), 1500);

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

      // Blocked: recipient has blocked the sender. Drop silently — don't store,
      // deliver, queue or push. The sender just sees the message as "sent"
      // (single tick), so they can't tell they've been blocked.
      if (await db.isBlocked(recipientAddress, address)) {
        console.log(`🚫 Dropped message from ${address} — blocked by ${recipientAddress}`);
        socket.emit('message:queued', { messageId: message.id, recipientAddress });
        return;
      }

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
        const outbound = {
          id: message.id,
          senderId: message.senderId,
          recipientId: message.recipientId,
          content: message.content,
          type: message.type,
          timestamp: message.timestamp,
          conversationId: conversationId,
          deliveredAt: Date.now(),
        };

        // Don't block this handler waiting for the ack
        emitWithReach(recipientAddress, 'message', outbound).then(async (reach) => {
          if (reach.status === 'delivered') {
            socket.emit('message:delivered', {
              messageId: message.id,
              conversationId: conversationId,
              timestamp: Date.now(),
            });
            // App is open but backgrounded (e.g. phone locked) → push so they notice
            if (!reach.visible) {
              await sendMessagePush(recipientAddress, address, message.senderName, 'Sent you a message', conversationId || '');
            }
            return;
          }
          // Socket was stale (iOS suspended the app) — queue + push like offline
          try {
            await db.queueOfflineMessage(
              recipientAddress, address, message.content, message.type || 'text',
              message.id, conversationId || undefined
            );
          } catch (e) {
            console.error('Failed to queue message after missing ack:', e);
          }
          await sendMessagePush(recipientAddress, address, message.senderName, 'Sent you a message', conversationId || '');
          socket.emit('message:queued', { messageId: message.id, recipientAddress });
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

        // Recipient is offline → send a push notification so they see the message.
        // SECURITY: E2E — generic body only, never the content.
        await sendMessagePush(recipientAddress, address, message.senderName, 'Sent you a message', conversationId || '');

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
  // Message Edits
  // ----------------------

  socket.on('message:edit', async ({ messageId, conversationId, senderId, content, encryptedPayloads, editedAt }: {
    messageId: string;
    conversationId: string;
    senderId: string;
    content: string;
    encryptedPayloads?: Record<string, string>;
    editedAt: number;
  }) => {
    try {
      console.log('✏️ Edit:', { messageId, conversationId, senderId });

      // Persist the new content (and per-recipient payloads for group chats)
      await db.editMessage(messageId, content, encryptedPayloads);

      const conversation = await db.getConversationById(conversationId);
      if (!conversation) {
        console.log('Conversation not found for edit');
        return;
      }

      // Broadcast to all other participants (not the sender - they already
      // applied the edit optimistically on their own device)
      for (const participant of conversation.participants) {
        const participantLower = participant.toLowerCase();
        if (participantLower === senderId.toLowerCase()) continue;

        const participantSocketId = activeConnections.get(participantLower);
        if (!participantSocketId) continue;

        // For group chats, give each participant their own encrypted payload,
        // same resolution used for new group messages
        let participantContent = content;
        if (encryptedPayloads && encryptedPayloads[participantLower]) {
          participantContent = encryptedPayloads[participantLower];
        }

        io.to(participantSocketId).emit('message:edit', {
          messageId,
          conversationId,
          senderId,
          content: participantContent,
          editedAt,
        });
      }
    } catch (error) {
      console.error('Error handling message:edit:', error);
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

      // Blocked: behave like the recipient is unreachable (no ring, no push)
      if (await db.isBlocked(recipient, address)) {
        console.log(`🚫 Call from ${address} suppressed — blocked by ${recipient}`);
        socket.emit('call:unavailable', { callId: finalCallId, recipientAddress: recipient, reason: 'offline' });
        return;
      }

      console.log('Call initiated:', {
        from: address,
        to: recipient,
        callId: finalCallId,
        type: callType,
        recipientOnline: !!recipientSocketId
      });

      if (recipientSocketId) {
        // Confirm call initiated to caller with the SAME call ID
        socket.emit('call:initiated', { callId: finalCallId, recipientAddress: recipient });

        // Ring over the socket, but verify it actually landed. If the recipient's
        // app is backgrounded / locked (no ack, or not visible) also send the
        // call push so the phone actually rings.
        emitWithReach(recipient, 'call:incoming', {
          callerId: address,
          callerName: callerName, // Pass caller's @name
          callType,
          offer,
          callId: finalCallId,
        }).then(async (reach) => {
          if (reach.status === 'delivered' && reach.visible) return;
          console.log(`📞 ${recipient} not on screen (${reach.status}) — sending call push`);
          let displayName = callerName;
          if (!displayName) {
            try {
              const callerProfile = await db.getUserByWallet(address);
              displayName = callerProfile?.username || truncateAddress(address);
            } catch {
              displayName = truncateAddress(address);
            }
          }
          await sendCallPushNotification(recipient, finalCallId, address, displayName, callType, offer);
        }).catch((err) => console.error('Call reach check failed:', err));
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
        await sendCallPushNotification(
          recipient,
          finalCallId,
          address,
          displayName,
          callType,
          offer  // <-- ADD THIS: Pass the offer so it's stored for retrieval
        );

        // if (pushSent) {
          console.log(`📞 Push notification sent for call ${finalCallId}`);
          // Tell the caller we're trying to reach them via push
          socket.emit('call:initiated', {
            callId: finalCallId,
            recipientAddress: recipient,
            viaPush: true // Indicate this went via push, not direct socket
          });
        // } else {
        //   // No push tokens or push failed
        //   socket.emit('call:unavailable', {
        //     recipientAddress: recipient,
        //     reason: 'User is offline and push notifications unavailable',
        //   });
        // }
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
      // callTokenService.removePendingCall(callId);
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
      // callTokenService.removePendingCall(callId);
    } catch (error) {
      console.error('Error ending call:', error);
    }
  });

  // Handle missed call - creates a message in chat
  socket.on('call:missed', async ({
    callId,
    callerId,
    recipientId,
    callType,
    callerName,
    reason
  }: {
    callId: string;
    callerId: string;
    recipientId: string;
    callType: 'audio' | 'video';
    callerName?: string;
    reason: 'timeout' | 'declined' | 'unavailable';
  }) => {
    try {
      console.log('═══════════════════════════════════════');
      console.log('📞 MISSED CALL EVENT RECEIVED');
      console.log('  CallId:', callId);
      console.log('  From (callerId):', callerId);
      console.log('  To (recipientId):', recipientId);
      console.log('  Type:', callType);
      console.log('  Reason:', reason);
      console.log('  CallerName:', callerName);
      console.log('═══════════════════════════════════════');

      // Validate required fields
      if (!callId || !callerId || !recipientId) {
        console.error('❌ Missing required fields for missed call!');
        console.error('  callId:', callId);
        console.error('  callerId:', callerId);
        console.error('  recipientId:', recipientId);
        return;
      }

      // Create a system message for the missed call
      const conversationId = [callerId.toLowerCase(), recipientId.toLowerCase()]
        .sort()
        .join('-');

      console.log('📝 Generated conversationId:', conversationId);

      // FIX: Use callerId as senderId so the message appears in the correct conversation
      // The isSystemMessage flag indicates it's a system-generated message for special rendering
      const missedCallMessage = {
        id: `missed-call-${callId}-${Date.now()}`,
        conversationId,
        // Changed from 'system' to callerId to ensure message goes to correct conversation
        senderId: callerId.toLowerCase(),
        recipientId: recipientId.toLowerCase(),
        content: '', // System messages don't have text content
        type: 'system',
        isSystemMessage: true,
        systemMessageType: reason === 'declined' ? 'call_declined' : 'missed_call',
        callType,
        timestamp: Date.now(),
        delivered: true,
        read: false,
        metadata: {
          callId,
          callerId: callerId.toLowerCase(),
          callerName: callerName || truncateAddress(callerId),
          reason,
        },
      };

      console.log('📝 Created missed call message:', JSON.stringify(missedCallMessage, null, 2));

      // Save to database - first ensure conversation exists
      try {
        // Get or create conversation between caller and recipient (returns string ID)
        const conversationId = await db.getOrCreateDirectConversation(
          callerId.toLowerCase(),
          recipientId.toLowerCase()
        );

        // Create the message content as a JSON object with all the metadata
        const messageContent = JSON.stringify({
          isSystemMessage: true,
          systemMessageType: reason === 'declined' ? 'call_declined' : 'missed_call',
          callType,
          callId,
          callerId: callerId.toLowerCase(),
          callerName: callerName || truncateAddress(callerId),
          reason,
        });

        // Save using correct function signature: (conversationId, senderWallet, content, messageType, clientId)
        await db.saveMessage(
          conversationId,
          callerId.toLowerCase(),
          messageContent,
          'system',
          missedCallMessage.id
        );
        console.log('✅ Missed call message saved to DB');
      } catch (dbError) {
        console.error('❌ Failed to save missed call message to DB:', dbError);
      }

      // Send to recipient if online
      const recipientSocketId = activeConnections.get(recipientId.toLowerCase());
      console.log('📤 Recipient socket lookup:', recipientId.toLowerCase(), '→', recipientSocketId || 'NOT ONLINE');

      if (recipientSocketId) {
        io.to(recipientSocketId).emit('message', missedCallMessage);
        console.log('✅ Missed call message sent to recipient via socket');
      } else {
        console.log('⚠️ Recipient not online, message saved to DB only');
      }

      // Also send to caller so they see it in their chat
      const callerSocketId = activeConnections.get(callerId.toLowerCase());
      console.log('📤 Caller socket lookup:', callerId.toLowerCase(), '→', callerSocketId || 'NOT ONLINE');

      if (callerSocketId) {
        io.to(callerSocketId).emit('message', missedCallMessage);
        console.log('✅ Missed call message sent to caller via socket');
      } else {
        console.log('⚠️ Caller not online (unusual), message saved to DB only');
      }

      // Send push notification for missed call
      const pushSent = await sendMissedCallPushNotification(
        recipientId.toLowerCase(),
        callerId.toLowerCase(),
        callerName || truncateAddress(callerId),
        callType
      );

      if (pushSent) {
        console.log('📱 Missed call push notification sent');
      } else {
        console.log('⚠️ No push notification sent (recipient may not have FCM token)');
      }

      console.log('═══════════════════════════════════════');
      console.log('✅ MISSED CALL HANDLING COMPLETE');
      console.log('═══════════════════════════════════════');
    } catch (error) {
      console.error('❌ Error handling missed call:', error);
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

  socket.on('group:message', async ({ groupId: rawGroupId, message, recipients, groupInfo }: any) => {
    try {
      // Old clients may address the group by its Mongo _id — normalise to group_id
      const groupId = await db.canonicalGroupId(rawGroupId);
      if (groupId !== rawGroupId) {
        console.log(`🔧 group:message used legacy id ${rawGroupId} → ${groupId}`);
        if (groupInfo && typeof groupInfo === 'object') groupInfo = { ...groupInfo, id: groupId };
      }
      console.log(`📢 Group message in ${groupId} from ${address}:`, message.content?.substring(0, 30));

      // For encrypted group messages, we store a marker and send individual payloads
      const isEncrypted = message.content === '__ENCRYPTED_GROUP__' && message.encryptedPayloads;

      // Save message to database (store encrypted marker or plain text).
      // A DB failure must NEVER block live delivery / push to the other members —
      // that's exactly what caused group messages to arrive with no alert.
      try {
        await db.saveMessage(
          groupId,
          address,
          message.content,
          message.type || 'text',
          message.id,
          isEncrypted ? message.encryptedPayloads : undefined // Store encrypted payloads
        );
      } catch (dbErr) {
        console.error(`Failed to save group message ${message.id} (continuing with delivery):`, dbErr);
      }

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

        const groupName = (groupInfo && (groupInfo.name || groupInfo.groupName))
          ? String(groupInfo.name || groupInfo.groupName) : '';
        const pushBody = groupName ? `New message in ${groupName}` : 'Sent a message to the group';

        const queueAndPush = async () => {
          try {
            await db.queueOfflineMessage(
              recipientAddress,
              address,           // sender wallet
              recipientContent,  // their encrypted content
              message.type || 'text',
              message.id,        // client ID
              groupId,           // conversation ID
              groupInfo          // group metadata
            );
            console.log(`   → Queued offline for ${recipientAddress}`);
          } catch (e) {
            console.error(`Failed to queue group message for ${recipientAddress}:`, e);
          }
          // Generic push — never the encrypted content
          await sendMessagePush(recipientLower, address, message.senderName, pushBody, groupId);
        };

        if (recipientSocketId) {
          console.log(`   → Sending to ${recipientAddress} (encrypted: ${isEncrypted})`);
          emitWithReach(recipientLower, 'message', recipientMessage).then(async (reach) => {
            if (reach.status !== 'delivered') {
              await queueAndPush();
            } else if (!reach.visible) {
              await sendMessagePush(recipientLower, address, message.senderName, pushBody, groupId);
            }
          });
        } else {
          await queueAndPush();
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

  socket.on('group:call:initiate', async ({ recipientAddress, callType, offer, callId, groupId, groupName, participants, callerName }: any) => {
    try {
      const recipient = String(recipientAddress || '').toLowerCase();
      if (!recipient || !callId) return;

      // Respect blocks: a member who blocked the caller just isn't rung
      if (await db.isBlocked(recipient, address)) {
        console.log(`🚫 Group call ring to ${recipient} suppressed — blocked ${address}`);
        return;
      }

      let call = groupCalls.get(callId);
      if (!call) {
        let initiatorName = callerName;
        if (!initiatorName) {
          try {
            const u = await db.getUserByWallet(address);
            initiatorName = u?.username ? `@${String(u.username).replace(/^@/, '')}` : undefined;
          } catch { /* ignore */ }
        }
        call = {
          callId,
          groupId,
          groupName: groupName || 'Group',
          callType: callType === 'video' ? 'video' : 'audio',
          initiator: address,
          initiatorName,
          participants: (participants || []).map((p: string) => p.toLowerCase()),
          offers: new Map(),
          pending: new Map(),
          pushed: new Set(),
          joined: new Set(),
          createdAt: Date.now(),
        };
        groupCalls.set(callId, call);
      }

      call.offers.set(recipient, offer);
      call.pending.set(recipient, Date.now());

      console.log('Group call initiated:', { from: address, to: recipient, callId, groupId, type: callType });
      ringGroupMember(call, recipient);
    } catch (error) {
      console.error('Error initiating group call:', error);
    }
  });

  // Mesh signalling between two members (offer / answer / ICE), relayed as-is
  socket.on('group:call:mesh:signal', ({ callId, toAddress, peerId, signal }: any) => {
    try {
      const call = groupCalls.get(callId);
      const to = String(toAddress || '').toLowerCase();
      if (!call || !to) return;
      const inCall = (a: string) => a === call.initiator || call.joined.has(a);
      if (!inCall(address) || !inCall(to)) return;
      emitToUser(to, 'group:call:mesh:signal', { callId, peerId, signal, from: address });
    } catch (error) {
      console.error('Error relaying mesh signal:', error);
    }
  });

  // Client asks for anything still ringing for it (app came to foreground / push tapped)
  socket.on('call:resync', () => {
    resyncPendingCalls(address);
  });

  // A member declined a group call
  socket.on('group:call:decline', ({ callId }: any) => {
    const call = groupCalls.get(callId);
    if (!call) return;
    call.pending.delete(address);
    emitToUser(call.initiator, 'group:call:participant:declined', { callId, address, participantAddress: address });
    console.log(`📵 ${address} declined group call ${callId}`);
  });

  socket.on('group:call:answer', ({ callId, answer, peerId, toAddress }: any) => {
    try {
      // Extract caller address from callId (format: groupId-timestamp)
      // The toAddress should be the caller
      const call = groupCalls.get(callId);
      if (call) {
        call.pending.delete(address);
        call.joined.add(address);
      }
      const target = String(toAddress || call?.initiator || '').toLowerCase();
      const recipientSocketId = activeConnections.get(target);

      console.log('Group call answer:', { callId, peerId, toAddress: target, hasSocket: !!recipientSocketId });

      if (recipientSocketId) {
        io.to(recipientSocketId).emit('group:call:answer', {
          callId,
          answer,
          peerId,
          fromAddress: address,
        });
        io.to(recipientSocketId).emit('group:call:participant:joined', {
          callId,
          participantAddress: address,
        });
        console.log(`   → Group call answer sent to ${target}`);
      }

      if (call) {
        // Full mesh: tell the newcomer who's already in, so they connect to each
        // (they make the offers), and tell those members someone joined.
        const others = [...call.joined].filter(m => m !== address);
        socket.emit('group:call:roster', { callId, peers: others, initiator: call.initiator });
        for (const m of others) {
          emitToUser(m, 'group:call:participant:joined', { callId, participantAddress: address });
        }
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

  const leaveGroupCall = async (callId: string, groupIdHint?: string) => {
    const call = groupCalls.get(callId);
    if (!call) {
      // Unknown call (server restarted?) — best effort via group membership
      if (!groupIdHint) return;
      const members = await db.getGroupMembers(groupIdHint);
      for (const m of members) {
        if (m.toLowerCase() !== address) {
          emitToUser(m, 'group:call:participant:left', { callId, address, participantAddress: address });
        }
      }
      return;
    }
    call.joined.delete(address);
    call.pending.delete(address);
    const notify = new Set<string>([call.initiator, ...call.joined]);
    notify.delete(address);
    for (const m of notify) {
      emitToUser(m, 'group:call:participant:left', { callId, address, participantAddress: address });
    }
    console.log(`👋 ${address} left group call ${callId}`);
  };

  socket.on('group:call:end', async ({ callId, groupId }: any) => {
    try {
      const call = groupCalls.get(callId);

      // A non-initiator hanging up just leaves; the call continues for others
      if (call && call.initiator !== address) {
        await leaveGroupCall(callId, groupId);
        return;
      }

      console.log(`Group call ended: ${callId} by ${address}`);
      const recipients = new Set<string>();
      if (call) {
        call.participants.forEach(p => recipients.add(p));
        call.pending.forEach((_, p) => recipients.add(p));
        call.joined.forEach(p => recipients.add(p));
        groupCalls.delete(callId);
      } else if (groupId) {
        (await db.getGroupMembers(groupId)).forEach(m => recipients.add(m.toLowerCase()));
      }
      recipients.delete(address);
      for (const m of recipients) {
        emitToUser(m, 'group:call:ended', { callId, endedBy: address });
      }
    } catch (error) {
      console.error('Error ending group call:', error);
    }
  });

  socket.on('group:call:leave', async ({ callId, groupId }: any) => {
    try {
      await leaveGroupCall(callId, groupId);
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
      socketToWallet.delete(socket.id);
      // Only clear the mapping if it still points at THIS socket. When a phone
      // reconnects, the new socket registers first and the old one's disconnect
      // fires later (ping timeout) — deleting unconditionally made the user look
      // offline while they were actually connected.
      if (activeConnections.get(address) !== socket.id) {
        console.log(`   (stale socket for ${address} closed; newer connection kept)`);
        return;
      }
      activeConnections.delete(address);
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