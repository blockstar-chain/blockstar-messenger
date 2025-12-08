'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store';
import AuthPage from '@/components/AuthPage';
import MainLayout from '@/components/MainLayout';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import { initNativePlugins } from '@/lib/capacitor';
import { useAppKitAccount } from '@reown/appkit/react';

export default function HomePage() {
  const { address } = useAppKitAccount();
  const { isAuthenticated } = useAppStore();


  useEffect(() => {
    console.log(isAuthenticated)
    if(isAuthenticated){
      initNativePlugins(address)
    }
  }, [isAuthenticated , address]);

  // Register service worker for PWA
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('ServiceWorker registered:', registration.scope);
        })
        .catch((error) => {
          console.warn('ServiceWorker registration failed:', error);
        });
    }
  }, []);

  return (
    <>
      {isAuthenticated ? <MainLayout /> : <AuthPage />}
      <PWAInstallPrompt />
    </>
  );
}
