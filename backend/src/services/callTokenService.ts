// backend/src/services/callTokenService.ts
// Manages authentication tokens for incoming call deep links
// Tokens are short-lived and used to authenticate users opening /call from push notifications

import crypto from 'crypto';

interface PendingCall {
  callId: string;
  callerId: string;
  callerName?: string;
  callType: 'audio' | 'video';
  recipientWallet: string;
  offer?: any;  // WebRTC offer stored here for retrieval
  token: string;
  createdAt: number;
  expiresAt: number;
}

// In-memory store for pending calls
// In production, you might want to use Redis for multi-instance support
const pendingCalls = new Map<string, PendingCall>();
const tokenToCallId = new Map<string, string>();

// Token expiry time (5 minutes)
const TOKEN_EXPIRY_MS = 5 * 60 * 1000;

// Cleanup interval (run every minute)
const CLEANUP_INTERVAL_MS = 60 * 1000;

/**
 * Generate a secure random token
 */
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a pending call entry with auth token
 * Returns the token to include in the push notification
 */
export function createPendingCall(
  callId: string,
  callerId: string,
  callerName: string | undefined,
  callType: 'audio' | 'video',
  recipientWallet: string,
  offer?: any
): string {
  const token = generateToken();
  const now = Date.now();
  
  const pendingCall: PendingCall = {
    callId,
    callerId,
    callerName,
    callType,
    recipientWallet: recipientWallet.toLowerCase(),
    offer,
    token,
    createdAt: now,
    expiresAt: now + TOKEN_EXPIRY_MS,
  };
  
  // Store by callId and token
  pendingCalls.set(callId, pendingCall);
  tokenToCallId.set(token, callId);
  
  console.log(`📞 [CallToken] Created pending call:`);
  console.log(`   Call ID: ${callId}`);
  console.log(`   Recipient: ${recipientWallet.substring(0, 10)}...`);
  console.log(`   Token: ${token.substring(0, 16)}...`);
  console.log(`   Expires: ${new Date(pendingCall.expiresAt).toISOString()}`);
  
  return token;
}

/**
 * Update the offer for a pending call
 * Called when the caller's WebRTC offer is ready
 */
export function updateCallOffer(callId: string, offer: any): boolean {
  const pendingCall = pendingCalls.get(callId);
  
  if (!pendingCall) {
    console.log(`📞 [CallToken] Cannot update offer - call not found: ${callId}`);
    return false;
  }
  
  pendingCall.offer = offer;
  console.log(`📞 [CallToken] Updated offer for call: ${callId}`);
  return true;
}

/**
 * Verify a call token and return call data if valid
 * Returns null if token is invalid or expired
 */
export function verifyCallToken(token: string): {
  callId: string;
  callerId: string;
  callerName?: string;
  callType: 'audio' | 'video';
  recipientWallet: string;
} | null {
  const callId = tokenToCallId.get(token);
  
  if (!callId) {
    console.log(`📞 [CallToken] Token not found: ${token.substring(0, 16)}...`);
    return null;
  }
  
  const pendingCall = pendingCalls.get(callId);
  
  if (!pendingCall) {
    console.log(`📞 [CallToken] Call not found for token: ${callId}`);
    tokenToCallId.delete(token);
    return null;
  }
  
  // Check expiry
  if (Date.now() > pendingCall.expiresAt) {
    console.log(`📞 [CallToken] Token expired for call: ${callId}`);
    // Clean up expired entry
    pendingCalls.delete(callId);
    tokenToCallId.delete(token);
    return null;
  }
  
  console.log(`📞 [CallToken] Token verified for call: ${callId}`);
  
  return {
    callId: pendingCall.callId,
    callerId: pendingCall.callerId,
    callerName: pendingCall.callerName,
    callType: pendingCall.callType,
    recipientWallet: pendingCall.recipientWallet,
  };
}

/**
 * Get the WebRTC offer for a call
 * Used by the mobile /call page to get the offer to answer
 */
export function getCallOffer(callId: string): any | null {
  const pendingCall = pendingCalls.get(callId);
  
  if (!pendingCall) {
    console.log(`📞 [CallToken] Offer not found - call not found: ${callId}`);
    return null;
  }
  
  // Check expiry
  if (Date.now() > pendingCall.expiresAt) {
    console.log(`📞 [CallToken] Offer expired for call: ${callId}`);
    return null;
  }
  
  if (!pendingCall.offer) {
    console.log(`📞 [CallToken] No offer stored yet for call: ${callId}`);
    return null;
  }
  
  console.log(`📞 [CallToken] Returning offer for call: ${callId}`);
  return pendingCall.offer;
}

/**
 * Get pending call by callId
 */
export function getPendingCall(callId: string): PendingCall | null {
  const pendingCall = pendingCalls.get(callId);
  
  if (!pendingCall) {
    return null;
  }
  
  // Check expiry
  if (Date.now() > pendingCall.expiresAt) {
    pendingCalls.delete(callId);
    if (pendingCall.token) {
      tokenToCallId.delete(pendingCall.token);
    }
    return null;
  }
  
  return pendingCall;
}

/**
 * Remove a pending call (when answered or declined)
 */
export function removePendingCall(callId: string): void {
  const pendingCall = pendingCalls.get(callId);
  
  if (pendingCall) {
    tokenToCallId.delete(pendingCall.token);
    pendingCalls.delete(callId);
    console.log(`📞 [CallToken] Removed pending call: ${callId}`);
  }
}

/**
 * Clean up expired calls
 */
function cleanupExpiredCalls(): void {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [callId, pendingCall] of pendingCalls.entries()) {
    if (now > pendingCall.expiresAt) {
      tokenToCallId.delete(pendingCall.token);
      pendingCalls.delete(callId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`📞 [CallToken] Cleaned up ${cleaned} expired pending calls`);
  }
}

// Start cleanup interval
setInterval(cleanupExpiredCalls, CLEANUP_INTERVAL_MS);

export default {
  createPendingCall,
  updateCallOffer,
  verifyCallToken,
  getCallOffer,
  getPendingCall,
  removePendingCall,
};
