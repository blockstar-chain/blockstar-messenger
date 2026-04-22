// frontend/src/hooks/useEncryptionInit.ts
// Hook to ensure encryption is initialized when wallet is connected

import { useEffect, useState, useCallback } from 'react';
import { useConnection, useSignMessage } from 'wagmi';
import { encryptionService } from '@/lib/encryption';
import { useAppStore } from '@/store';
import toast from 'react-hot-toast';

interface EncryptionInitState {
  isReady: boolean;
  isInitializing: boolean;
  needsSignature: boolean;
  error: string | null;
}

/**
 * Hook to manage encryption initialization
 * 
 * This hook ensures that when a user is logged in (session restored),
 * the encryption service is properly initialized by asking for a signature.
 * 
 * Without this, messages cannot be decrypted after app reload.
 */
export function useEncryptionInit() {
  const { address, isConnected } = useConnection();
  const { signMessageAsync } = useSignMessage();
  const { currentUser, setCurrentUser } = useAppStore();
  
  const [state, setState] = useState<EncryptionInitState>({
    isReady: encryptionService.isReady(),
    isInitializing: false,
    needsSignature: false,
    error: null,
  });

  // Check if we need to initialize encryption
  useEffect(() => {
    const checkEncryption = () => {
      const isReady = encryptionService.isReady();
      const hasUser = !!currentUser?.walletAddress;
      const walletConnected = isConnected && address;
      
      // If user is logged in but encryption isn't ready, we need a signature
      const needsInit = hasUser && !isReady && walletConnected;
      
      setState(prev => ({
        ...prev,
        isReady,
        needsSignature: needsInit,
      }));
      
      if (needsInit) {
        console.log('🔐 Encryption not ready - user needs to sign to derive keys');
      }
    };
    
    checkEncryption();
    
    // Check periodically in case state changes
    const interval = setInterval(checkEncryption, 2000);
    return () => clearInterval(interval);
  }, [currentUser?.walletAddress, isConnected, address]);

  // Function to initialize encryption
  const initializeEncryption = useCallback(async () => {
    if (!address || state.isInitializing) return false;
    
    setState(prev => ({ ...prev, isInitializing: true, error: null }));
    
    try {
      console.log('🔐 Initializing encryption for:', address);
      
      // Create sign function wrapper
      const signMessageFn = async (message: string) => {
        return await signMessageAsync({ message });
      };
      
      // Initialize encryption service
      await encryptionService.initialize(address, signMessageFn);
      
      const publicKey = await encryptionService.getPublicKey();
      
      // Update user with public key if needed
      if (currentUser && publicKey && currentUser.publicKey !== publicKey) {
        setCurrentUser({
          ...currentUser,
          publicKey,
        });
      }
      
      console.log('✅ Encryption initialized successfully');
      toast.success('Encryption keys ready!');
      
      setState({
        isReady: true,
        isInitializing: false,
        needsSignature: false,
        error: null,
      });
      
      return true;
    } catch (error: any) {
      console.error('❌ Failed to initialize encryption:', error);
      
      // User rejected signature - this is expected if they cancel
      const isUserRejection = error.message?.includes('User rejected') || 
                              error.message?.includes('User denied') ||
                              error.code === 4001;
      
      if (!isUserRejection) {
        toast.error('Failed to initialize encryption');
      }
      
      setState(prev => ({
        ...prev,
        isInitializing: false,
        error: isUserRejection ? 'Signature required' : error.message,
      }));
      
      return false;
    }
  }, [address, signMessageAsync, currentUser, setCurrentUser, state.isInitializing]);

  // Auto-initialize when needed and wallet is connected
  useEffect(() => {
    if (state.needsSignature && !state.isInitializing && !state.isReady) {
      // Small delay to let the UI settle
      const timer = setTimeout(() => {
        initializeEncryption();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [state.needsSignature, state.isInitializing, state.isReady, initializeEncryption]);

  return {
    ...state,
    initializeEncryption,
  };
}

export default useEncryptionInit;
