// frontend/src/hooks/useMeshNetwork.ts
// React hook for mesh network integration

import { useState, useEffect, useCallback } from 'react';
import { 
  meshNetworkService, 
  MeshNetworkStatus, 
  MeshPeer, 
  MeshMessage 
} from '@/lib/mesh/MeshNetworkService';

interface UseMeshNetworkOptions {
  walletAddress: string;
  publicKey: string;
  username?: string;
  serverUrl?: string;
  autoInitialize?: boolean;
}

interface UseMeshNetworkReturn {
  // Status
  status: MeshNetworkStatus;
  isOnline: boolean;
  isMeshMode: boolean;
  isInitialized: boolean;
  
  // Peers
  connectedPeers: MeshPeer[];
  
  // Messages
  messages: MeshMessage[];
  sendMessage: (to: string, content: string) => Promise<{ success: boolean; messageId: string }>;
  
  // Connection
  createConnectionOffer: () => Promise<{ qrData: string }>;
  acceptConnectionOffer: (qrData: string) => Promise<{ qrData: string }>;
  completeConnection: (qrData: string) => Promise<void>;
  
  // Actions
  initialize: () => Promise<void>;
  shutdown: () => void;
}

export function useMeshNetwork(options: UseMeshNetworkOptions): UseMeshNetworkReturn {
  const { walletAddress, publicKey, username, serverUrl, autoInitialize = true } = options;
  
  const [status, setStatus] = useState<MeshNetworkStatus>({
    isOnline: true,
    isMeshMode: false,
    connectedPeers: 0,
    knownPeers: 0,
    queuedMessages: 0,
    lastServerCheck: Date.now(),
  });
  const [connectedPeers, setConnectedPeers] = useState<MeshPeer[]>([]);
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize
  const initialize = useCallback(async () => {
    if (!walletAddress || !publicKey) return;
    
    await meshNetworkService.initialize(walletAddress, publicKey, username, serverUrl);
    setIsInitialized(true);
    setStatus(meshNetworkService.getStatus());
    setConnectedPeers(meshNetworkService.getConnectedPeers());
  }, [walletAddress, publicKey, username, serverUrl]);

  // Auto-initialize
  useEffect(() => {
    if (autoInitialize && walletAddress && publicKey) {
      initialize();
    }
  }, [autoInitialize, walletAddress, publicKey, initialize]);

  // Subscribe to status changes
  useEffect(() => {
    const unsubscribeStatus = meshNetworkService.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    const unsubscribePeers = meshNetworkService.onPeerChange((peer, event) => {
      setConnectedPeers(meshNetworkService.getConnectedPeers());
    });

    const unsubscribeMessages = meshNetworkService.onMessage((message) => {
      setMessages((prev) => [...prev, message]);
    });

    return () => {
      unsubscribeStatus();
      unsubscribePeers();
      unsubscribeMessages();
    };
  }, []);

  // Send message
  const sendMessage = useCallback(
    async (to: string, content: string) => {
      return meshNetworkService.sendMessage(to, content);
    },
    []
  );

  // Connection offer/answer
  const createConnectionOffer = useCallback(async () => {
    const result = await meshNetworkService.createConnectionOffer();
    return { qrData: result.qrData };
  }, []);

  const acceptConnectionOffer = useCallback(async (qrData: string) => {
    const result = await meshNetworkService.acceptConnectionOffer(qrData);
    return { qrData: result.qrData };
  }, []);

  const completeConnection = useCallback(async (qrData: string) => {
    await meshNetworkService.completeConnection(qrData);
    setConnectedPeers(meshNetworkService.getConnectedPeers());
  }, []);

  // Shutdown
  const shutdown = useCallback(() => {
    meshNetworkService.shutdown();
    setIsInitialized(false);
  }, []);

  return {
    status,
    isOnline: status.isOnline,
    isMeshMode: status.isMeshMode,
    isInitialized,
    connectedPeers,
    messages,
    sendMessage,
    createConnectionOffer,
    acceptConnectionOffer,
    completeConnection,
    initialize,
    shutdown,
  };
}

export default useMeshNetwork;
