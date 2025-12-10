// frontend/src/components/NotificationPermissionPrompt.tsx
// Shows when notification permission is denied with retry option

import React, { useState, useEffect } from 'react';
import { Bell, BellOff, X, RefreshCw } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { getPermissionInfo, retryPermissionRequest } from '@/lib/pushNotifications';

interface NotificationPermissionPromptProps {
  show: boolean;
  onDismiss: () => void;
  onPermissionGranted?: () => void;
}

export function NotificationPermissionPrompt({
  show,
  onDismiss,
  onPermissionGranted,
}: NotificationPermissionPromptProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [timeUntilRetry, setTimeUntilRetry] = useState(0);
  const [canRetry, setCanRetry] = useState(true);

  // Update retry status
  useEffect(() => {
    if (!show) return;

    const updateStatus = () => {
      const info = getPermissionInfo();
      setCanRetry(info.canRetryNow);
      setTimeUntilRetry(info.timeUntilRetry);
    };

    updateStatus();
    const interval = setInterval(updateStatus, 1000);

    return () => clearInterval(interval);
  }, [show]);

  const handleRetry = async () => {
    setIsRetrying(true);
    
    try {
      const granted = await retryPermissionRequest();
      
      if (granted) {
        onPermissionGranted?.();
        onDismiss();
      }
    } catch (error) {
      console.error('Error retrying permission:', error);
    } finally {
      setIsRetrying(false);
    }
  };

  const formatTime = (ms: number): string => {
    if (ms <= 0) return '';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  if (!show || !Capacitor.isNativePlatform()) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
      <div className="bg-gray-800 rounded-2xl p-6 max-w-md w-full shadow-xl border border-gray-700">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center">
              <BellOff className="w-6 h-6 text-yellow-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">
                Notifications Disabled
              </h3>
              <p className="text-sm text-gray-400">
                You may miss important updates
              </p>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="text-gray-400 hover:text-white p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="mb-6">
          <p className="text-gray-300 text-sm mb-4">
            Enable notifications to receive:
          </p>
          <ul className="space-y-2 text-sm text-gray-400">
            <li className="flex items-center gap-2">
              <span className="text-green-400">📞</span>
              Incoming call alerts (even when app is closed)
            </li>
            <li className="flex items-center gap-2">
              <span className="text-blue-400">💬</span>
              New message notifications
            </li>
            <li className="flex items-center gap-2">
              <span className="text-red-400">📵</span>
              Missed call reminders
            </li>
          </ul>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          {canRetry ? (
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 
                         text-white rounded-xl font-medium flex items-center justify-center gap-2
                         transition-colors"
            >
              {isRetrying ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Requesting...
                </>
              ) : (
                <>
                  <Bell className="w-5 h-5" />
                  Enable Notifications
                </>
              )}
            </button>
          ) : (
            <div className="w-full py-3 px-4 bg-gray-700 text-gray-400 rounded-xl text-center text-sm">
              Can retry in {formatTime(timeUntilRetry)}
            </div>
          )}
          
          <button
            onClick={onDismiss}
            className="w-full py-3 px-4 bg-gray-700 hover:bg-gray-600 
                       text-gray-300 rounded-xl font-medium transition-colors"
          >
            Maybe Later
          </button>
        </div>

        {/* Help text */}
        <p className="mt-4 text-xs text-gray-500 text-center">
          If the prompt doesn't appear, go to Settings → Apps → BlockStar Cypher → Notifications
        </p>
      </div>
    </div>
  );
}

export default NotificationPermissionPrompt;
