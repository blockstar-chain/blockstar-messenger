// frontend/src/lib/missedCallService.ts
// Tracks missed calls and creates system messages in chat

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { addMissedCall, showMissedCallNotification } from './notificationService';

// ============================================
// TYPES
// ============================================

export interface MissedCall {
  id: string;
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  callType: 'audio' | 'video';
  timestamp: number;
  seen: boolean;
}

const MISSED_CALLS_KEY = 'blockstar_missed_calls';

// ============================================
// STORAGE
// ============================================

/**
 * Get all missed calls
 */
export async function getMissedCalls(): Promise<MissedCall[]> {
  try {
    let data: string | null = null;
    
    if (Capacitor.isNativePlatform()) {
      data = (await Preferences.get({ key: MISSED_CALLS_KEY })).value;
    } else {
      data = localStorage.getItem(MISSED_CALLS_KEY);
    }

    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to get missed calls:', error);
  }
  return [];
}

/**
 * Save missed calls
 */
async function saveMissedCalls(calls: MissedCall[]): Promise<void> {
  try {
    const data = JSON.stringify(calls);
    
    if (Capacitor.isNativePlatform()) {
      await Preferences.set({ key: MISSED_CALLS_KEY, value: data });
    } else {
      localStorage.setItem(MISSED_CALLS_KEY, data);
    }
  } catch (error) {
    console.error('Failed to save missed calls:', error);
  }
}

/**
 * Add a missed call
 */
export async function addMissedCallRecord(
  callerId: string,
  callerName: string,
  callType: 'audio' | 'video',
  callerAvatar?: string
): Promise<MissedCall> {
  const missedCall: MissedCall = {
    id: `missed-${callerId}-${Date.now()}`,
    callerId,
    callerName,
    callerAvatar,
    callType,
    timestamp: Date.now(),
    seen: false,
  };

  const calls = await getMissedCalls();
  calls.unshift(missedCall); // Add to beginning
  
  // Keep only last 100 missed calls
  if (calls.length > 100) {
    calls.splice(100);
  }
  
  await saveMissedCalls(calls);
  
  // Update badge
  await addMissedCall();
  
  // Show notification
  await showMissedCallNotification(callerName, callerId, callType);
  
  console.log('📞 Missed call recorded:', missedCall);
  return missedCall;
}

/**
 * Mark missed calls as seen for a specific caller
 */
export async function markMissedCallsSeen(callerId: string): Promise<void> {
  const calls = await getMissedCalls();
  let updated = false;
  
  calls.forEach(call => {
    if (call.callerId.toLowerCase() === callerId.toLowerCase() && !call.seen) {
      call.seen = true;
      updated = true;
    }
  });
  
  if (updated) {
    await saveMissedCalls(calls);
    console.log('📞 Marked missed calls as seen for:', callerId);
  }
}

/**
 * Get unseen missed calls count
 */
export async function getUnseenMissedCallsCount(): Promise<number> {
  const calls = await getMissedCalls();
  return calls.filter(c => !c.seen).length;
}

/**
 * Get missed calls for a specific caller
 */
export async function getMissedCallsForCaller(callerId: string): Promise<MissedCall[]> {
  const calls = await getMissedCalls();
  return calls.filter(c => c.callerId.toLowerCase() === callerId.toLowerCase());
}

/**
 * Clear all missed calls
 */
export async function clearAllMissedCalls(): Promise<void> {
  await saveMissedCalls([]);
  console.log('📞 All missed calls cleared');
}

/**
 * Delete a specific missed call
 */
export async function deleteMissedCall(callId: string): Promise<void> {
  const calls = await getMissedCalls();
  const filtered = calls.filter(c => c.id !== callId);
  await saveMissedCalls(filtered);
  console.log('📞 Deleted missed call:', callId);
}

// ============================================
// CALL EVENT HANDLERS
// ============================================

/**
 * Handle when a call is missed (timeout, declined by caller, etc.)
 * Call this from your call handling logic
 */
export async function handleCallMissed(
  callerId: string,
  callerName: string,
  callType: 'audio' | 'video',
  callerAvatar?: string
): Promise<void> {
  await addMissedCallRecord(callerId, callerName, callType, callerAvatar);
  
  // Dispatch event for UI to react
  window.dispatchEvent(new CustomEvent('missedCall', {
    detail: { callerId, callerName, callType, callerAvatar }
  }));
}

// ============================================
// SYSTEM MESSAGE CREATION
// ============================================

/**
 * Create a system message for missed call to show in chat
 * Returns the message object to be added to the conversation
 */
export function createMissedCallMessage(
  callerId: string,
  callerName: string,
  callType: 'audio' | 'video',
  currentUserAddress: string
): {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  timestamp: number;
  isSystemMessage: boolean;
  systemMessageType: 'missed_call';
  metadata: {
    callType: 'audio' | 'video';
    callerName: string;
  };
} {
  const conversationId = [callerId.toLowerCase(), currentUserAddress.toLowerCase()]
    .sort()
    .join('-');

  return {
    id: `system-missed-call-${Date.now()}`,
    conversationId,
    senderId: 'system',
    content: `Missed ${callType} call from ${callerName}`,
    timestamp: Date.now(),
    isSystemMessage: true,
    systemMessageType: 'missed_call',
    metadata: {
      callType,
      callerName,
    },
  };
}
