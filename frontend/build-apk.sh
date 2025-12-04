#!/bin/bash

set -e

echo "--------------------------------------"
echo "🔥 Building Web App"
echo "--------------------------------------"
npm run build

echo "--------------------------------------"
echo "🔄 Syncing Capacitor"
echo "--------------------------------------"
npx cap sync android

echo "--------------------------------------"
echo "📦 Building Signed Release APK"
echo "--------------------------------------"
cd android
./gradlew assembleRelease

APK_PATH="app/build/outputs/apk/release/app-release.apk"

echo "--------------------------------------"
echo "✅ Build Complete!"
echo "APK generated at:"
echo "$APK_PATH"
echo "--------------------------------------"

# Auto install if device is connected
if adb devices | grep -w "device" > /dev/null; then
    echo "📱 Device detected. Installing APK..."
    adb install -r "$APK_PATH"
    echo "🎉 APK installed successfully!"
else
    echo "⚠️ No device detected. Skipping installation."
fi

cd ..
