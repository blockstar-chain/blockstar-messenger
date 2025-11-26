import io, { Socket } from 'socket.io-client';

class WebSocketService {
  private socket: Socket | null = null;
  
  async connect(token: string): Promise<void> {
    try {
      this.socket = io('http://192.168.1.100:3001', { // CHANGE THIS TO YOUR SERVER IP
        auth: { token },
        transports: ['websocket'],
        timeout: 5000,
      });
      
      this.socket.on('connect', () => console.log('✅ WebSocket connected'));
      this.socket.on('disconnect', () => console.log('❌ WebSocket disconnected'));
      this.socket.on('connect_error', (error) => console.log('⚠️ WebSocket error:', error.message));
    } catch (error) {
      console.log('⚠️ WebSocket connection failed:', error);
      // Don't throw - allow app to work without backend
    }
  }
  
  emit(event: string, data: any) { 
    if (this.socket?.connected) {
      this.socket.emit(event, data); 
    } else {
      console.log('⚠️ WebSocket not connected, cannot emit:', event);
    }
  }
  
  on(event: string, handler: Function) { 
    this.socket?.on(event, handler as any); 
  }
  
  disconnect() { 
    this.socket?.disconnect(); 
  }
}

export const webSocketService = new WebSocketService();
