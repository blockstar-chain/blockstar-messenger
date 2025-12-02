// frontend/src/contexts/MeshContext.tsx
// React context for mesh network state management

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { 
  meshNetworkService, 
  MeshNetworkStatus, 
  MeshPeer, 
  MeshMessage 
} from '@/lib/mesh/MeshNetworkService';

interface MeshContextValue {
  // State
  status: MeshNetworkStatus;
  isOnline: boolean;
  isMeshMode: boolean;
  connectedPeers: MeshPeer[];
  pendingMessages: MeshMessage[];
  
  // Actions
  initialize: (walletAddress: string, publicKey: string, username?: string) => Promise<void>;
  sendMeshMessage: (to: string, content: string) => Promise<boolean>;
  createOffer: () => Promise<string>;
  acceptOffer: (qrData: string) => Promise<string>;
  completeConnection: (qrData: string) => Promise<void>;
  shutdown: () => void;
}

const defaultStatus: MeshNetworkStatus = {
  isOnline: true,
  isMeshMode: false,
  connectedPeers: 0,
  knownPeers: 0,
  queuedMessages: 0,
  lastServerCheck: Date.now(),
};

const MeshContext = createContext<MeshContextValue | null>(null);

export function MeshProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<MeshNetworkStatus>(defaultStatus);
  const [connectedPeers, setConnectedPeers] = useState<MeshPeer[]>([]);
  const [pendingMessages, setPendingMessages] = useState<MeshMessage[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Subscribe to mesh events
  useEffect(() => {
    const unsubStatus = meshNetworkService.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    const unsubPeers = meshNetworkService.onPeerChange(() => {
      setConnectedPeers(meshNetworkService.getConnectedPeers());
    });

    const unsubMessages = meshNetworkService.onMessage((message) => {
      setPendingMessages((prev) => [...prev, message]);
      
      // Dispatch global event for ChatArea to handle
      window.dispatchEvent(new CustomEvent('mesh-message', { detail: message }));
    });

    return () => {
      unsubStatus();
      unsubPeers();
      unsubMessages();
    };
  }, []);

  // Initialize mesh network
  const initialize = useCallback(async (
    walletAddress: string, 
    publicKey: string, 
    username?: string
  ) => {
    if (isInitialized) return;
    
    const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
    await meshNetworkService.initialize(walletAddress, publicKey, username, serverUrl);
    setIsInitialized(true);
    setStatus(meshNetworkService.getStatus());
    setConnectedPeers(meshNetworkService.getConnectedPeers());
  }, [isInitialized]);

  // Send message via mesh
  const sendMeshMessage = useCallback(async (to: string, content: string): Promise<boolean> => {
    const result = await meshNetworkService.sendMessage(to, content);
    return result.success;
  }, []);

  // QR connection methods
  const createOffer = useCallback(async (): Promise<string> => {
    const { qrData } = await meshNetworkService.createConnectionOffer();
    return qrData;
  }, []);

  const acceptOffer = useCallback(async (qrData: string): Promise<string> => {
    const { qrData: answerData } = await meshNetworkService.acceptConnectionOffer(qrData);
    return answerData;
  }, []);

  const completeConnection = useCallback(async (qrData: string): Promise<void> => {
    await meshNetworkService.completeConnection(qrData);
    setConnectedPeers(meshNetworkService.getConnectedPeers());
  }, []);

  // Shutdown
  const shutdown = useCallback(() => {
    meshNetworkService.shutdown();
    setIsInitialized(false);
    setStatus(defaultStatus);
    setConnectedPeers([]);
  }, []);

  const value: MeshContextValue = {
    status,
    isOnline: status.isOnline,
    isMeshMode: status.isMeshMode,
    connectedPeers,
    pendingMessages,
    initialize,
    sendMeshMessage,
    createOffer,
    acceptOffer,
    completeConnection,
    shutdown,
  };

  return (
    <MeshContext.Provider value={value}>
      {children}
    </MeshContext.Provider>
  );
}

export function useMesh(): MeshContextValue {
  const context = useContext(MeshContext);
  if (!context) {
    throw new Error('useMesh must be used within a MeshProvider');
  }
  return context;
}

export default MeshContext;
