import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'world.blockstar.cypher',
  appName: 'BlockStar Cypher',
  webDir: 'out',
  bundledWebRuntime: false,
  
  // Server config for development with live reload
  server: {
    // For development: use your local network IP
    // url: 'http://192.168.1.100:3000',
    // cleartext: true,
    
    // For production: comment out url to use bundled assets
    androidScheme: 'https',
    iosScheme: 'https',
  },
  
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0a0a0f',
      showSpinner: false,
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0a0a0f',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
  
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    scheme: 'BlockStar Cypher',
  },
  
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
