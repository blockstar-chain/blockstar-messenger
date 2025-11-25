import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface User {
  walletAddress: string;
  username: string;
  publicKey: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setAuthenticated: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  logout: () => void;
  loadStoredAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  isLoading: true,

  setUser: (user) => {
    set({ user });
    if (user) {
      AsyncStorage.setItem('user', JSON.stringify(user));
    } else {
      AsyncStorage.removeItem('user');
    }
  },

  setAuthenticated: (value) => {
    set({ isAuthenticated: value });
    AsyncStorage.setItem('isAuthenticated', String(value));
  },

  setLoading: (value) => set({ isLoading: value }),

  logout: async () => {
    await AsyncStorage.multiRemove(['user', 'isAuthenticated']);
    set({ isAuthenticated: false, user: null });
  },

  loadStoredAuth: async () => {
    try {
      const [storedUser, storedAuth] = await AsyncStorage.multiGet([
        'user',
        'isAuthenticated',
      ]);

      if (storedUser[1] && storedAuth[1] === 'true') {
        set({
          user: JSON.parse(storedUser[1]),
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.error('Failed to load stored auth:', error);
      set({ isLoading: false });
    }
  },
}));
