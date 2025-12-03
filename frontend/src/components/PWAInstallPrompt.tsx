// frontend/src/components/PWAInstallPrompt.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Download, X, Share, Plus } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWAInstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already installed (standalone mode)
    const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches 
      || (window.navigator as any).standalone === true;
    setIsStandalone(isInStandaloneMode);

    // Check if iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(iOS);

    // Check if user dismissed before
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    const dismissedTime = dismissed ? parseInt(dismissed) : 0;
    const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
    
    // Don't show if already installed or recently dismissed (within 7 days)
    if (isInStandaloneMode || daysSinceDismissed < 7) {
      return;
    }

    // Listen for the beforeinstallprompt event (Android/Desktop Chrome)
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // For iOS, show prompt after a delay if not installed
    if (iOS && !isInStandaloneMode) {
      const timer = setTimeout(() => setShowPrompt(true), 3000);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      };
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      // Android/Chrome install
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
      }
      
      setDeferredPrompt(null);
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
    setShowPrompt(false);
  };

  // Don't render if already installed or shouldn't show
  if (isStandalone || !showPrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 animate-slide-up">
      <div className="bg-card border border-primary-500/30 rounded-2xl p-4 shadow-2xl shadow-primary-500/20">
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 p-1 hover:bg-dark-200 rounded-lg transition"
        >
          <X size={16} className="text-muted" />
        </button>

        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary-500/20 flex items-center justify-center flex-shrink-0">
            <Download className="w-6 h-6 text-primary-500" />
          </div>
          
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white">Install BlockStar</h3>
            <p className="text-sm text-muted mt-1">
              {isIOS 
                ? 'Add to your home screen for the best experience'
                : 'Install the app for quick access and notifications'}
            </p>

            {isIOS ? (
              // iOS instructions
              <div className="mt-3 flex items-center gap-2 text-sm text-secondary">
                <span>Tap</span>
                <Share size={16} className="text-primary-400" />
                <span>then</span>
                <span className="flex items-center gap-1 bg-dark-200 px-2 py-0.5 rounded">
                  <Plus size={14} />
                  Add to Home Screen
                </span>
              </div>
            ) : (
              // Android/Chrome install button
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleInstall}
                  className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition"
                >
                  Install App
                </button>
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2 bg-dark-200 hover:bg-dark-100 text-secondary text-sm rounded-lg transition"
                >
                  Not Now
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
