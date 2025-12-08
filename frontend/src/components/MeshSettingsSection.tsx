// frontend/src/components/MeshSettingsSection.tsx
// Mesh Network section for the main Settings modal
// This provides quick access to mesh settings and status

'use client';

import React, { useState, useEffect } from 'react';
import { Radio, Bluetooth, MapPin, ChevronRight, Loader2, CheckCircle, AlertCircle, Users } from 'lucide-react';
import { meshNetworkService, MeshNetworkStatus, MeshSettings } from '@/lib/mesh/MeshNetworkService';
import { Capacitor } from '@capacitor/core';

interface MeshSettingsSectionProps {
  onOpenFullSettings?: () => void;
}

export default function MeshSettingsSection({ onOpenFullSettings }: MeshSettingsSectionProps) {
  const [settings, setSettings] = useState<MeshSettings>(meshNetworkService.getSettings());
  const [status, setStatus] = useState<MeshNetworkStatus>(meshNetworkService.getStatus());
  const [isEnabling, setIsEnabling] = useState(false);
  const [permissions, setPermissions] = useState({ bluetooth: false, location: false });
  
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    // Subscribe to status changes
    const unsubscribe = meshNetworkService.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    // Check permissions
    meshNetworkService.checkPermissions().then(setPermissions);

    // Listen for permission changes
    const unsubPermission = meshNetworkService.onPermissionChange((type, granted) => {
      setPermissions(prev => ({ ...prev, [type]: granted }));
    });

    return () => {
      unsubscribe();
      unsubPermission();
    };
  }, []);

  const handleToggleMesh = async () => {
    setIsEnabling(true);
    try {
      if (settings.enabled) {
        await meshNetworkService.updateSettings({ enabled: false });
      } else {
        const success = await meshNetworkService.enableMeshNetworking();
        if (!success && isNative) {
          alert('Failed to enable mesh networking. Please grant Bluetooth and Location permissions in your device settings.');
        }
      }
      setSettings(meshNetworkService.getSettings());
    } finally {
      setIsEnabling(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Main Toggle */}
      <div className="p-4 bg-dark-200 border border-midnight rounded-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              settings.enabled ? 'bg-purple-500/20' : 'bg-gray-700'
            }`}>
              <Radio className={`w-5 h-5 ${settings.enabled ? 'text-purple-400' : 'text-gray-400'}`} />
            </div>
            <div>
              <p className="font-medium text-white">Enable Mesh Networking</p>
              <p className="text-xs text-secondary">
                {settings.enabled 
                  ? `${status.connectedPeers} connected, ${status.discoveredPeers} nearby`
                  : 'Communicate without internet'
                }
              </p>
            </div>
          </div>
          
          <button
            onClick={handleToggleMesh}
            disabled={isEnabling}
            className={`
              relative w-12 h-7 rounded-full transition-colors duration-200
              ${settings.enabled ? 'bg-purple-500' : 'bg-gray-600'}
              ${isEnabling ? 'opacity-50' : ''}
            `}
          >
            {isEnabling ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-white" />
              </div>
            ) : (
              <div className={`
                absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
                ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}
              `} />
            )}
          </button>
        </div>
      </div>

      {/* Quick Status (when enabled) */}
      {settings.enabled && (
        <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-xl">
          <div className="flex items-center gap-2 text-sm">
            <Users className="w-4 h-4 text-purple-400" />
            <span className="text-purple-300">
              {status.isMeshMode 
                ? 'Mesh mode active - communicating offline'
                : 'Online - ready for mesh if needed'
              }
            </span>
          </div>
          {status.bleScanning && (
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Scanning for nearby devices...</span>
            </div>
          )}
        </div>
      )}

      {/* Permissions Status (Native only) */}
      {isNative && settings.enabled && (
        <div className="p-3 bg-dark-200 border border-midnight rounded-xl space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Bluetooth className="w-4 h-4 text-blue-400" />
              <span className="text-gray-300">Bluetooth</span>
            </div>
            {permissions.bluetooth ? (
              <CheckCircle className="w-4 h-4 text-green-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-yellow-400" />
            )}
          </div>
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-green-400" />
              <span className="text-gray-300">Location</span>
            </div>
            {permissions.location ? (
              <CheckCircle className="w-4 h-4 text-green-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-yellow-400" />
            )}
          </div>
          {(!permissions.bluetooth || !permissions.location) && (
            <p className="text-xs text-yellow-400 mt-2">
              Grant permissions in device settings for full functionality
            </p>
          )}
        </div>
      )}

      {/* Advanced Settings Button */}
      {onOpenFullSettings && (
        <button
          onClick={onOpenFullSettings}
          className="w-full p-3 bg-dark-200 border border-midnight rounded-xl text-left hover:bg-midnight-light transition flex items-center justify-between"
        >
          <span className="text-sm text-gray-300">Advanced mesh settings</span>
          <ChevronRight size={18} className="text-secondary" />
        </button>
      )}

      {/* Info */}
      <p className="text-xs text-gray-500 px-1">
        Mesh networking enables direct device-to-device communication via Bluetooth 
        when internet is unavailable. Perfect for events, conferences, or emergencies.
      </p>
    </div>
  );
}
