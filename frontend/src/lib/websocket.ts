import { io, Socket } from 'socket.io-client';
import { Message } from '@/types';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

export class WebSocketService {
  private socket: Socket | null = null;
  private userAddress: string | null = null;
  private messageHandlers: Set<(message: Message) => void> = new Set();
  private callHandlers: Set<(data: any) => void> = new Set();
  private statusHandlers: Set<(data: { address: string; status: string }) => void> = new Set();

  /**
   * Connect to WebSocket server
   */
  connect(walletAddress: string, publicKey: string, username?: string): void {
    this.userAddress = walletAddress;

    this.socket = io(SOCKET_URL, {
      auth: {
        walletAddress,
        publicKey,
        username,
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    this.setupEventHandlers();
  }

  /**
   * Setup socket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('Connected to messaging server');
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from messaging server');
    });

    this.socket.on('message', (message: Message) => {
      this.messageHandlers.forEach((handler) => handler(message));
    });

    this.socket.on('call:incoming', (data: any) => {
      this.callHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('call:answer', (data: any) => {
      this.callHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('call:ice-candidate', (data: any) => {
      this.callHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('user:status', (data: { address: string; status: string }) => {
      this.statusHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('error', (error: any) => {
      console.error('Socket error:', error);
    });
  }

  /**
   * Send an encrypted message
   */
  sendMessage(message: Message): void {
    if (!this.socket || !this.socket.connected) {
      throw new Error('Not connected to messaging server');
    }

    this.socket.emit('message:send', message);
  }

  /**
   * Mark message as delivered
   */
  markDelivered(messageId: string): void {
    if (!this.socket || !this.socket.connected) return;
    
    this.socket.emit('message:delivered', { messageId });
  }

  /**
   * Mark message as read
   */
  markRead(messageId: string): void {
    if (!this.socket || !this.socket.connected) return;
    
    this.socket.emit('message:read', { messageId });
  }

  /**
   * Initiate a call
   */
  initiateCall(recipientAddress: string, callType: 'audio' | 'video', offer: any, callId: string): void {
    if (!this.socket || !this.socket.connected) {
      throw new Error('Not connected to messaging server');
    }

    this.socket.emit('call:initiate', {
      recipientAddress,
      callType,
      offer,
      callId,  // Send the call ID we already created
    });
  }

  /**
   * Answer a call
   */
  answerCall(callId: string, answer: any): void {
    if (!this.socket || !this.socket.connected) {
      throw new Error('Not connected to messaging server');
    }

    this.socket.emit('call:answer', {
      callId,
      answer,
    });
  }

  /**
   * Send ICE candidate
   */
  sendIceCandidate(recipientAddress: string, candidate: any, callId?: string): void {
    if (!this.socket || !this.socket.connected) return;

    console.log('📤 Sending ICE candidate to:', recipientAddress, 'for call:', callId);
    
    this.socket.emit('call:ice-candidate', {
      recipientAddress,
      candidate,
      callId,
    });
  }

  /**
   * End a call
   */
  endCall(callId: string): void {
    if (!this.socket || !this.socket.connected) return;

    this.socket.emit('call:end', { callId });
  }

  /**
   * Update user status
   */
  updateStatus(status: 'online' | 'away' | 'offline'): void {
    if (!this.socket || !this.socket.connected) return;

    this.socket.emit('user:status', { status });
  }

  /**
   * Register message handler
   */
  onMessage(handler: (message: Message) => void): () => void {
    this.messageHandlers.add(handler);
    
    // Return unsubscribe function
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /**
   * Register call handler
   */
  onCall(handler: (data: any) => void): () => void {
    this.callHandlers.add(handler);
    
    return () => {
      this.callHandlers.delete(handler);
    };
  }

  /**
   * Register status handler
   */
  onStatus(handler: (data: { address: string; status: string }) => void): () => void {
    this.statusHandlers.add(handler);
    
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    this.userAddress = null;
    this.messageHandlers.clear();
    this.callHandlers.clear();
    this.statusHandlers.clear();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /**
   * Generic emit method for custom events
   */
  emit(event: string, data: any): void {
    if (!this.socket || !this.socket.connected) {
      console.warn('Socket not connected, cannot emit:', event);
      return;
    }
    this.socket.emit(event, data);
  }

  /**
   * Generic listener for custom events
   */
  on(event: string, handler: (data: any) => void): () => void {
    if (this.socket) {
      this.socket.on(event, handler);
    }
    return () => {
      if (this.socket) {
        this.socket.off(event, handler);
      }
    };
  }
}

export const webSocketService = new WebSocketService();
