// frontend/src/lib/persistentAuth.ts
// Keeps users logged in until they explicitly log out

import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

const AUTH_KEYS = {
  WALLET_ADDRESS: 'blockstar_wallet_address',
  USERNAME: 'blockstar_username',
  AVATAR: 'blockstar_avatar',
  PUBLIC_KEY: 'blockstar_public_key',
  SESSION_TOKEN: 'blockstar_session_token',
  LOGIN_TIMESTAMP: 'blockstar_login_timestamp',
  IS_LOGGED_IN: 'blockstar_is_logged_in',
};

export interface StoredUserData {
  walletAddress: string;
  username?: string;
  avatar?: string;
  publicKey?: string;
  sessionToken?: string;
  loginTimestamp?: number;
}

/**
 * Save user session after successful login
 */
export async function saveUserSession(userData: StoredUserData): Promise<void> {
  console.log('💾 Saving user session:', userData.walletAddress);
  
  try {
    if (Capacitor.isNativePlatform()) {
      // Use Capacitor Preferences for native (more reliable than localStorage)
      await Preferences.set({ key: AUTH_KEYS.WALLET_ADDRESS, value: userData.walletAddress });
      await Preferences.set({ key: AUTH_KEYS.USERNAME, value: userData.username || '' });
      await Preferences.set({ key: AUTH_KEYS.AVATAR, value: userData.avatar || '' });
      await Preferences.set({ key: AUTH_KEYS.PUBLIC_KEY, value: userData.publicKey || '' });
      await Preferences.set({ key: AUTH_KEYS.SESSION_TOKEN, value: userData.sessionToken || '' });
      await Preferences.set({ key: AUTH_KEYS.LOGIN_TIMESTAMP, value: Date.now().toString() });
      await Preferences.set({ key: AUTH_KEYS.IS_LOGGED_IN, value: 'true' });
    } else {
      // Use localStorage for web
      localStorage.setItem(AUTH_KEYS.WALLET_ADDRESS, userData.walletAddress);
      localStorage.setItem(AUTH_KEYS.USERNAME, userData.username || '');
      localStorage.setItem(AUTH_KEYS.AVATAR, userData.avatar || '');
      localStorage.setItem(AUTH_KEYS.PUBLIC_KEY, userData.publicKey || '');
      localStorage.setItem(AUTH_KEYS.SESSION_TOKEN, userData.sessionToken || '');
      localStorage.setItem(AUTH_KEYS.LOGIN_TIMESTAMP, Date.now().toString());
      localStorage.setItem(AUTH_KEYS.IS_LOGGED_IN, 'true');
    }
    
    console.log('✅ User session saved successfully');
  } catch (error) {
    console.error('❌ Failed to save user session:', error);
  }
}

/**
 * Get stored user session
 */
export async function getStoredSession(): Promise<StoredUserData | null> {
  try {
    let walletAddress: string | null = null;
    let username: string | null = null;
    let avatar: string | null = null;
    let publicKey: string | null = null;
    let sessionToken: string | null = null;
    let loginTimestamp: string | null = null;
    let isLoggedIn: string | null = null;

    if (Capacitor.isNativePlatform()) {
      // Use Capacitor Preferences for native
      walletAddress = (await Preferences.get({ key: AUTH_KEYS.WALLET_ADDRESS })).value;
      username = (await Preferences.get({ key: AUTH_KEYS.USERNAME })).value;
      avatar = (await Preferences.get({ key: AUTH_KEYS.AVATAR })).value;
      publicKey = (await Preferences.get({ key: AUTH_KEYS.PUBLIC_KEY })).value;
      sessionToken = (await Preferences.get({ key: AUTH_KEYS.SESSION_TOKEN })).value;
      loginTimestamp = (await Preferences.get({ key: AUTH_KEYS.LOGIN_TIMESTAMP })).value;
      isLoggedIn = (await Preferences.get({ key: AUTH_KEYS.IS_LOGGED_IN })).value;
    } else {
      // Use localStorage for web
      walletAddress = localStorage.getItem(AUTH_KEYS.WALLET_ADDRESS);
      username = localStorage.getItem(AUTH_KEYS.USERNAME);
      avatar = localStorage.getItem(AUTH_KEYS.AVATAR);
      publicKey = localStorage.getItem(AUTH_KEYS.PUBLIC_KEY);
      sessionToken = localStorage.getItem(AUTH_KEYS.SESSION_TOKEN);
      loginTimestamp = localStorage.getItem(AUTH_KEYS.LOGIN_TIMESTAMP);
      isLoggedIn = localStorage.getItem(AUTH_KEYS.IS_LOGGED_IN);
    }

    if (!walletAddress || isLoggedIn !== 'true') {
      console.log('📭 No stored session found');
      return null;
    }

    console.log('📬 Found stored session for:', walletAddress);
    
    return {
      walletAddress,
      username: username || undefined,
      avatar: avatar || undefined,
      publicKey: publicKey || undefined,
      sessionToken: sessionToken || undefined,
      loginTimestamp: loginTimestamp ? parseInt(loginTimestamp) : undefined,
    };
  } catch (error) {
    console.error('❌ Failed to get stored session:', error);
    return null;
  }
}

/**
 * Check if user has a stored session
 */
export async function hasStoredSession(): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const isLoggedIn = (await Preferences.get({ key: AUTH_KEYS.IS_LOGGED_IN })).value;
      const walletAddress = (await Preferences.get({ key: AUTH_KEYS.WALLET_ADDRESS })).value;
      return isLoggedIn === 'true' && !!walletAddress;
    } else {
      const isLoggedIn = localStorage.getItem(AUTH_KEYS.IS_LOGGED_IN);
      const walletAddress = localStorage.getItem(AUTH_KEYS.WALLET_ADDRESS);
      return isLoggedIn === 'true' && !!walletAddress;
    }
  } catch (error) {
    console.error('❌ Failed to check stored session:', error);
    return false;
  }
}

/**
 * Clear user session (on logout)
 */
export async function clearUserSession(): Promise<void> {
  console.log('🗑️ Clearing user session');
  
  try {
    if (Capacitor.isNativePlatform()) {
      await Preferences.remove({ key: AUTH_KEYS.WALLET_ADDRESS });
      await Preferences.remove({ key: AUTH_KEYS.USERNAME });
      await Preferences.remove({ key: AUTH_KEYS.AVATAR });
      await Preferences.remove({ key: AUTH_KEYS.PUBLIC_KEY });
      await Preferences.remove({ key: AUTH_KEYS.SESSION_TOKEN });
      await Preferences.remove({ key: AUTH_KEYS.LOGIN_TIMESTAMP });
      await Preferences.remove({ key: AUTH_KEYS.IS_LOGGED_IN });
    } else {
      localStorage.removeItem(AUTH_KEYS.WALLET_ADDRESS);
      localStorage.removeItem(AUTH_KEYS.USERNAME);
      localStorage.removeItem(AUTH_KEYS.AVATAR);
      localStorage.removeItem(AUTH_KEYS.PUBLIC_KEY);
      localStorage.removeItem(AUTH_KEYS.SESSION_TOKEN);
      localStorage.removeItem(AUTH_KEYS.LOGIN_TIMESTAMP);
      localStorage.removeItem(AUTH_KEYS.IS_LOGGED_IN);
    }
    
    console.log('✅ User session cleared');
  } catch (error) {
    console.error('❌ Failed to clear user session:', error);
  }
}

/**
 * Update specific user data (e.g., when profile changes)
 */
export async function updateUserSession(updates: Partial<StoredUserData>): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      if (updates.username !== undefined) {
        await Preferences.set({ key: AUTH_KEYS.USERNAME, value: updates.username });
      }
      if (updates.avatar !== undefined) {
        await Preferences.set({ key: AUTH_KEYS.AVATAR, value: updates.avatar });
      }
      if (updates.publicKey !== undefined) {
        await Preferences.set({ key: AUTH_KEYS.PUBLIC_KEY, value: updates.publicKey });
      }
      if (updates.sessionToken !== undefined) {
        await Preferences.set({ key: AUTH_KEYS.SESSION_TOKEN, value: updates.sessionToken });
      }
    } else {
      if (updates.username !== undefined) {
        localStorage.setItem(AUTH_KEYS.USERNAME, updates.username);
      }
      if (updates.avatar !== undefined) {
        localStorage.setItem(AUTH_KEYS.AVATAR, updates.avatar);
      }
      if (updates.publicKey !== undefined) {
        localStorage.setItem(AUTH_KEYS.PUBLIC_KEY, updates.publicKey);
      }
      if (updates.sessionToken !== undefined) {
        localStorage.setItem(AUTH_KEYS.SESSION_TOKEN, updates.sessionToken);
      }
    }
    
    console.log('✅ User session updated');
  } catch (error) {
    console.error('❌ Failed to update user session:', error);
  }
}
