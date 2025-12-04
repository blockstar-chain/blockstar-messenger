import { io, Socket } from 'socket.io-client';
import { Message } from '@/types';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

export class WebSocketService {
  private socket: Socket | null = null;
  private userAddress: string | null = null;
  private publicKey: string | null = null;
  private username: string | undefined = undefined;
  private messageHandlers: Set<(message: Message) => void> = new Set();
  private callHandlers: Set<(data: any) => void> = new Set();
  private statusHandlers: Set<(data: { address: string; status: string }) => void> = new Set();
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;

  /**
   * Connect to WebSocket server
   */
  connect(walletAddress: string, publicKey: string, username?: string): void {
    this.userAddress = walletAddress;
    this.publicKey = publicKey;
    this.username = username;

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
      reconnectionAttempts: this.maxReconnectAttempts,
      // Keep connection alive
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.setupEventHandlers();
    this.startKeepalive();
  }

  /**
   * Start keepalive ping to prevent disconnection
   */
  private startKeepalive(): void {
    // Clear any existing interval
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
    }

    // Send ping every 20 seconds to keep connection alive
    this.keepaliveInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('ping');
      } else {
        console.log('🔌 Socket not connected, attempting reconnect...');
        this.attemptReconnect();
      }
    }, 20000);
  }

  /**
   * Attempt to reconnect if disconnected
   */
  private attemptReconnect(): void {
    if (!this.userAddress || !this.publicKey) return;
    
    if (this.socket && !this.socket.connected) {
      this.reconnectAttempts++;
      
      if (this.reconnectAttempts <= this.maxReconnectAttempts) {
        console.log(`🔄 Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        this.socket.connect();
      } else {
        console.log('❌ Max reconnect attempts reached, please refresh the page');
      }
    }
  }

  /**
   * Setup socket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('✅ Connected to messaging server');
      this.reconnectAttempts = 0; // Reset on successful connection
    });

    this.socket.on('disconnect', (reason) => {
      console.log('❌ Disconnected from messaging server:', reason);
      
      // Auto-reconnect for certain disconnect reasons
      if (reason === 'io server disconnect' || reason === 'transport close') {
        setTimeout(() => this.attemptReconnect(), 1000);
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error.message);
    });

    this.socket.on('pong', () => {
      // Server responded to ping - connection is alive
    });

    this.socket.on('message', (message: Message) => {
      this.messageHandlers.forEach((handler) => handler(message));
    });

    this.socket.on('call:incoming', (data: any) => {
      console.log('📞 call:incoming received:', data);
      this.callHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('call:answer', (data: any) => {
      console.log('📞 call:answer received:', data);
      this.callHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('call:ice-candidate', (data: any) => {
      console.log('🧊 call:ice-candidate received');
      this.callHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('call:initiated', (data: any) => {
      console.log('📞 call:initiated confirmation:', data);
    });

    this.socket.on('call:unavailable', (data: any) => {
      console.log('📞 call:unavailable:', data);
      this.callHandlers.forEach((handler) => handler({ type: 'unavailable', ...data }));
    });

    this.socket.on('call:ended', (data: any) => {
      console.log('📞 call:ended:', data);
      this.callHandlers.forEach((handler) => handler({ type: 'ended', ...data }));
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

    console.log('📤 Emitting call:initiate', {
      recipientAddress,
      callType,
      callId,
      hasOffer: !!offer,
    });

    this.socket.emit('call:initiate', {
      recipientAddress,
      callType,
      offer,
      callId,
    });
  }

  /**
   * Answer a call
   */
  answerCall(callId: string, answer: any): void {
    if (!this.socket || !this.socket.connected) {
      throw new Error('Not connected to messaging server');
    }

    console.log('📤 Emitting call:answer', {
      callId,
      hasAnswer: !!answer,
      answerType: answer?.type,
    });

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
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
    
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    this.userAddress = null;
    this.publicKey = null;
    this.username = undefined;
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
   * Get socket ID for debugging
   */
  getSocketId(): string | null {
    return this.socket?.id || null;
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
