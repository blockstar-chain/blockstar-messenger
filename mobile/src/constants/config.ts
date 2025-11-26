// ⚠️ IMPORTANT: Change these URLs to your server IP!
// For local development, use your computer's local IP (not localhost)
// For production, use your domain or server public IP

export const API_URL = __DEV__ 
  ? 'http://192.168.1.100:3001'  // CHANGE THIS to your local IP
  : 'https://api.yourdomain.com';  // CHANGE THIS to your production domain

export const WS_URL = __DEV__
  ? 'ws://192.168.1.100:3001'     // CHANGE THIS to your local IP
  : 'wss://api.yourdomain.com';   // CHANGE THIS to your production domain

// Find your local IP:
// Mac/Linux: ifconfig | grep "inet " | grep -v 127.0.0.1
// Windows: ipconfig | findstr IPv4
