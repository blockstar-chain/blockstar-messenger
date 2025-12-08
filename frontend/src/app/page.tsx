'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store';
import AuthPage from '@/components/AuthPage';
import MainLayout from '@/components/MainLayout';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import { initNativePlugins } from '@/lib/capacitor';

export default function HomePage() {
  const { isAuthenticated } = useAppStore();


  useEffect(() => {
    if(isAuthenticated){
      initNativePlugins()
    }
  }, [isAuthenticated]);

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
