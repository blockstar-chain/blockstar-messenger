# BlockStar Cypher Mobile App

Complete React Native mobile app with mesh networking.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Configure API URLs:
Edit `src/constants/config.ts` and set your server IP

3. Run on device:
```bash
# iOS
npx expo run:ios

# Android
npx expo run:android
```

## Build for Production

### iOS
```bash
eas build --platform ios
```

### Android
```bash
eas build --platform android
```

## Features

✅ Wallet authentication
✅ End-to-end encrypted messaging
✅ Voice & video calls
✅ File sharing
✅ Group chats
✅ Mesh networking (Bluetooth + WiFi Direct)
✅ Push notifications

## Mesh Networking

Requires physical devices - emulators don't support Bluetooth/WiFi Direct.

Test on 2+ phones with internet OFF to see mesh routing in action!
