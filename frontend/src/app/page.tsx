'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store';
import AuthPage from '@/components/AuthPage';
import MainLayout from '@/components/MainLayout';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import { useAutoLogin, useSessionPersistence } from '@/hooks/useAutoLogin';


export default function HomePage() {
  const { isAuthenticated, currentUser } = useAppStore();
  const { isChecking } = useAutoLogin();

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

  useSessionPersistence();

  return (
    <>
      {isAuthenticated ? <MainLayout /> :
        <>
          {isChecking &&(
              <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500" />
              </div>
            )}
          <AuthPage />
        </>
      }
      <PWAInstallPrompt />
    </>
  );
}
