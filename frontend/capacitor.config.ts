import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'site.blockstar.cypher',
  appName: 'BlockStar Cypher',
  webDir: 'out',
  bundledWebRuntime: false,

  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },

  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true, // FIX: without this the iOS splash can hang or never resolve
      backgroundColor: '#0a0a0f',
      showSpinner: false,
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      // iOS splash comes from the native LaunchScreen storyboard + the "Splash"
      // imageset in Assets.xcassets. Generate them with @capacitor/assets (see README).
      iosSpinnerStyle: 'small',
      splashFullScreen: true,
      splashImmersive: true,
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
    // FIX: removed `scheme: 'BlockStar Cypher'` — a URL scheme cannot contain
    // spaces; it was invalid and left the default. If you want a custom app-serving
    // scheme use a single token like `scheme: 'blockstarcypher'`. NOTE: the URL
    // scheme wallets use to RETURN to the app (WalletConnect deep-link) is a
    // SEPARATE thing set in Info.plist (CFBundleURLSchemes) — see README.
  },

  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
