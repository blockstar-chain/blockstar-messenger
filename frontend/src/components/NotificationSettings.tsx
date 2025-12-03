// frontend/src/components/NotificationSettings.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Volume2, VolumeX, Eye, EyeOff, Monitor, Play, AlertCircle, CheckCircle } from 'lucide-react';
import { notificationService, NotificationSettings } from '@/lib/notifications';
import toast from 'react-hot-toast';

interface NotificationSettingsProps {
  onClose?: () => void;
}

export default function NotificationSettingsPanel({ onClose }: NotificationSettingsProps) {
  const [settings, setSettings] = useState<NotificationSettings>(notificationService.getSettings());
  const [permissionStatus, setPermissionStatus] = useState<string>('default');

  useEffect(() => {
    setPermissionStatus(notificationService.getPermissionStatus());
  }, []);

  const handleToggle = (key: keyof NotificationSettings) => {
    const newValue = !settings[key];
    notificationService.updateSettings({ [key]: newValue });
    setSettings(notificationService.getSettings());
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseFloat(e.target.value);
    notificationService.setSoundVolume(volume);
    setSettings(notificationService.getSettings());
  };

  const handleRequestPermission = async () => {
    const granted = await notificationService.requestPermission();
    setPermissionStatus(notificationService.getPermissionStatus());

    if (granted) {
      toast.success('Desktop notifications enabled! 🎉');
      // Also enable desktop notifications in settings
      notificationService.updateSettings({ desktopNotifications: true });
      setSettings(notificationService.getSettings());
    } else {
      toast.error('Permission denied. Check browser settings to enable.');
    }
  };

  const handleTestNotification = async () => {
    // First check if we have permission
    if (permissionStatus !== 'granted') {
      toast.error('Please enable desktop notifications first');
      return;
    }

    await notificationService.testNotification();
    toast.success('Test notification sent! Check your desktop.');
  };

  return (
    <div className="space-y-4">
      {/* Permission Status - Always show this prominently */}
      <div className={`rounded-xl p-4 ${permissionStatus === 'granted'
        ? 'bg-success-500/10 border border-success-500/30'
        : permissionStatus === 'denied'
          ? 'bg-danger-500/10 border border-danger-500/30'
          : 'bg-yellow-500/10 border border-yellow-500/30'
        }`}>
        <div className="flex items-start gap-3">
          {permissionStatus === 'granted' ? (
            <CheckCircle className="w-5 h-5 text-success-500 mt-0.5" />
          ) : permissionStatus === 'denied' ? (
            <AlertCircle className="w-5 h-5 text-danger-500 mt-0.5" />
          ) : (
            <Bell className="w-5 h-5 text-yellow-500 mt-0.5" />
          )}
          <div className="flex-1">
            <p className={`font-medium ${permissionStatus === 'granted' ? 'text-success-400' :
              permissionStatus === 'denied' ? 'text-danger-400' : 'text-yellow-400'
              }`}>
              {permissionStatus === 'granted'
                ? 'Desktop Notifications Enabled ✓'
                : permissionStatus === 'denied'
                  ? 'Desktop Notifications Blocked'
                  : 'Enable Desktop Notifications'}
            </p>
            <p className="text-sm text-muted mt-1">
              {permissionStatus === 'granted'
                ? 'You will receive popup notifications when the app is in the background.'
                : permissionStatus === 'denied'
                  ? 'Notifications are blocked. Please enable them in your browser settings (click the lock icon in the address bar).'
                  : 'Click below to allow popup notifications when you receive new messages.'}
            </p>
            {permissionStatus === 'default' && (
              <button
                onClick={handleRequestPermission}
                className="mt-3 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-black font-medium rounded-lg transition"
              >
                Enable Desktop Popups
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Toggle */}
      <div className="bg-dark-200 border border-midnight rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {settings.enabled ? (
              <Bell className="w-5 h-5 text-primary-500" />
            ) : (
              <BellOff className="w-5 h-5 text-muted" />
            )}
            <div>
              <p className="text-white font-medium">All Notifications</p>
              <p className="text-sm text-muted">Sound & popups</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleToggle("enabled")}
            className={`relative w-12 h-6 rounded-full p-1 flex items-center transition-all duration-200 
        ${settings.enabled ? "bg-primary-500 justify-end" : "bg-dark-100 justify-start"}`}
          >
            <span className="w-4 h-4 bg-white rounded-full shadow-sm" />
          </button>
        </div>
      </div>


      {/* Sound Settings */}
      <div className="bg-dark-200 border border-midnight rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {settings.sound ? (
              <Volume2 className="w-5 h-5 text-primary-500" />
            ) : (
              <VolumeX className="w-5 h-5 text-muted" />
            )}

            <div>
              <p className="text-white font-medium">Sound</p>
              <p className="text-sm text-muted">Play beep for messages</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleToggle("sound")}
            disabled={!settings.enabled}
            className={`relative w-12 h-6 rounded-full p-1 flex items-center transition-all duration-200
        ${settings.sound && settings.enabled
                ? "bg-primary-500 justify-end"
                : "bg-dark-100 justify-start"
              }
        ${!settings.enabled ? "opacity-50 cursor-not-allowed" : ""}
      `}
          >
            <span className="w-4 h-4 bg-white rounded-full shadow-sm" />
          </button>
        </div>



        {/* Volume Slider */}
        {settings.sound && settings.enabled && (
          <div className="pl-8">
            <label className="text-sm text-muted mb-2 block">Volume: {Math.round(settings.soundVolume * 100)}%</label>
            <div className="flex items-center gap-3">
              <VolumeX className="w-4 h-4 text-muted" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={settings.soundVolume}
                onChange={handleVolumeChange}
                className="flex-1 h-2 bg-dark-100 rounded-lg appearance-none cursor-pointer accent-primary-500"
              />
              <Volume2 className="w-4 h-4 text-muted" />
            </div>
          </div>
        )}
      </div>

      {/* Show Message Preview */}
      <div className="bg-dark-200 border border-midnight rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {settings.showPreview ? (
              <Eye className="w-5 h-5 text-primary-500" />
            ) : (
              <EyeOff className="w-5 h-5 text-muted" />
            )}
            <div>
              <p className="text-white font-medium">Message Preview</p>
              <p className="text-sm text-muted">Show content in popups</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleToggle("showPreview")}
            disabled={!settings.enabled}
            className={`relative w-12 h-6 rounded-full p-1 flex items-center transition-all duration-200
        ${settings.showPreview && settings.enabled
                ? "bg-primary-500 justify-end"
                : "bg-dark-100 justify-start"
              }
        ${!settings.enabled ? "opacity-50 cursor-not-allowed" : ""}
      `}
          >
            <span className="w-4 h-4 bg-white rounded-full shadow-sm" />
          </button>
        </div>
      </div>


      {/* Test Button */}
      {settings.enabled && (
        <button
          onClick={handleTestNotification}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-dark-200 hover:bg-dark-100 text-white rounded-xl transition border border-midnight"
        >
          <Play className="w-4 h-4" />
          Test Notification
        </button>
      )}

      {/* Tip */}
      <p className="text-xs text-muted text-center">
        💡 Tip: You can mute specific chats from the chat menu (⋮)
      </p>
    </div>
  );
}
