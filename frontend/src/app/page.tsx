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
    // Lets you confirm in DevTools which build a tester is actually running
    console.log('🏷️ Cypher build: 2026-10-06-groupfix');

    if ('serviceWorker' in navigator) {
      // When a new service worker takes over (new deploy), reload once so the
      // page runs the new JS instead of the bundle it was loaded with.
      let reloaded = false;
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded || !hadController) return;
        reloaded = true;
        window.location.reload();
      });

      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((registration) => {
          console.log('ServiceWorker registered:', registration.scope);
          registration.update().catch(() => {});
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
