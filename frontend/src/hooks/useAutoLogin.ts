// frontend/src/hooks/useAutoLogin.ts
// Auto-login that properly handles incoming call notifications

import { useEffect, useState, useRef } from 'react';
import { useAppStore } from '@/store';
import { webSocketService } from '@/lib/websocket';
import { getStoredSession, hasStoredSession, saveUserSession, clearUserSession } from '@/lib/persistentAuth';
import { resolveProfile } from '@/lib/profileResolver';
import { Capacitor } from '@capacitor/core';

interface AutoLoginState {
  isChecking: boolean;
  isRestored: boolean;
  error: string | null;
}

/**
 * Auto-login hook that restores user session on app startup
 * Must complete BEFORE checking for incoming calls
 */
export function useAutoLogin() {
  const { currentUser, setCurrentUser } = useAppStore();
  const [state, setState] = useState<AutoLoginState>({
    isChecking: true,
    isRestored: false,
    error: null,
  });
  const hasAttempted = useRef(false);

  useEffect(() => {
    // Only attempt once
    if (hasAttempted.current) return;
    hasAttempted.current = true;

    const attemptAutoLogin = async () => {
      console.log('🔐 ========================================');
      console.log('🔐 AUTO-LOGIN: Checking for stored session...');
      console.log('🔐 ========================================');
      
      try {
        // Skip if user is already logged in
        if (currentUser?.walletAddress) {
          console.log('✅ User already logged in:', currentUser.walletAddress);
          setState({ isChecking: false, isRestored: true, error: null });
          return;
        }

        // Check for stored session
        const hasSession = await hasStoredSession();
        if (!hasSession) {
          console.log('📭 No stored session found - user needs to login');
          setState({ isChecking: false, isRestored: false, error: null });
          return;
        }

        // Get stored session data
        const storedSession = await getStoredSession();
        if (!storedSession) {
          console.log('📭 Could not retrieve session data');
          setState({ isChecking: false, isRestored: false, error: null });
          return;
        }

        console.log('🔄 Restoring session for:', storedSession.walletAddress);

        // Try to get updated profile info (but don't block on it)
        let username = storedSession.username;
        let avatar = storedSession.avatar;
        
        try {
          const profile = await resolveProfile(storedSession.walletAddress);
          if (profile) {
            username = profile.domain || username;
            avatar = profile.avatar || avatar;
          }
        } catch (e) {
          console.warn('Could not fetch updated profile, using stored data');
        }

        // Restore user to store
        setCurrentUser({
          walletAddress: storedSession.walletAddress,
          username: username,
          avatar: avatar,
          publicKey: storedSession.publicKey,
        });

        // Connect to WebSocket
        console.log('🔌 Connecting to WebSocket...');
        webSocketService.connect(storedSession.walletAddress);

        console.log('✅ ========================================');
        console.log('✅ AUTO-LOGIN: Session restored successfully!');
        console.log('✅ ========================================');
        
        setState({ isChecking: false, isRestored: true, error: null });

      } catch (error: any) {
        console.error('❌ Auto-login failed:', error);
        // Clear corrupted session
        await clearUserSession();
        setState({ isChecking: false, isRestored: false, error: error.message });
      }
    };

    attemptAutoLogin();
  }, [currentUser?.walletAddress, setCurrentUser]);

  return state;
}

/**
 * Hook to save session whenever user data changes
 * Use this alongside useAutoLogin
 */
export function useSessionPersistence() {
  const { currentUser } = useAppStore();

  useEffect(() => {
    const saveSession = async () => {
      if (currentUser?.walletAddress) {
        await saveUserSession({
          walletAddress: currentUser.walletAddress,
          username: currentUser.username,
          avatar: currentUser.avatar,
          publicKey: currentUser.publicKey,
        });
      }
    };

    saveSession();
  }, [currentUser?.walletAddress, currentUser?.username, currentUser?.avatar, currentUser?.publicKey]);
}

/**
 * Combined hook for auto-login with session persistence
 */
export function useAuthSession() {
  const autoLoginState = useAutoLogin();
  useSessionPersistence();
  return autoLoginState;
}
