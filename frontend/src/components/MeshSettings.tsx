// frontend/src/components/MeshSettings.tsx
// Settings panel for Mesh Networking configuration

'use client';

import React, { useState, useEffect } from 'react';
import {
  Radio,
  Bluetooth,
  Wifi,
  MapPin,
  ToggleLeft,
  ToggleRight,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Battery,
  Zap,
  Users,
  RefreshCw,
  Info,
} from 'lucide-react';
import { meshNetworkService, MeshSettings as MeshSettingsType, MeshNetworkStatus } from '@/lib/mesh/MeshNetworkService';
import { Capacitor } from '@capacitor/core';

interface MeshSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MeshSettingsComponent({ isOpen, onClose }: MeshSettingsProps) {
  const [settings, setSettings] = useState<MeshSettingsType>(meshNetworkService.getSettings());
  const [status, setStatus] = useState<MeshNetworkStatus>(meshNetworkService.getStatus());
  const [permissions, setPermissions] = useState({ bluetooth: false, location: false });
  const [isEnabling, setIsEnabling] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!isOpen) return;

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
  }, [isOpen]);

  const handleToggleMesh = async () => {
    setIsEnabling(true);
    try {
      if (settings.enabled) {
        await meshNetworkService.updateSettings({ enabled: false });
      } else {
        const success = await meshNetworkService.enableMeshNetworking();
        if (!success) {
          // Show error
          alert('Failed to enable mesh networking. Please check permissions.');
        }
      }
      setSettings(meshNetworkService.getSettings());
    } finally {
      setIsEnabling(false);
    }
  };

  const handleToggleBLE = async () => {
    await meshNetworkService.updateSettings({ bleEnabled: !settings.bleEnabled });
    setSettings(meshNetworkService.getSettings());
  };

  const handleToggleWifiDirect = async () => {
    await meshNetworkService.updateSettings({ wifiDirectEnabled: !settings.wifiDirectEnabled });
    setSettings(meshNetworkService.getSettings());
  };

  const handleToggleAutoConnect = async () => {
    await meshNetworkService.updateSettings({ autoConnect: !settings.autoConnect });
    setSettings(meshNetworkService.getSettings());
  };

  const handleToggleHybridMode = async () => {
    await meshNetworkService.updateSettings({ hybridMode: !settings.hybridMode });
    setSettings(meshNetworkService.getSettings());
  };

  const handleToggleStoreForward = async () => {
    await meshNetworkService.updateSettings({ storeAndForward: !settings.storeAndForward });
    setSettings(meshNetworkService.getSettings());
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-md max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
              <Radio className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Mesh Network</h2>
              <p className="text-xs text-gray-400">Offline communication settings</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg text-gray-400"
          >
            ✕
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[calc(90vh-80px)] space-y-4">
          {/* Main Toggle */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  settings.enabled ? 'bg-green-500/20' : 'bg-gray-700'
                }`}>
                  {settings.enabled ? (
                    <CheckCircle className="w-6 h-6 text-green-400" />
                  ) : (
                    <Radio className="w-6 h-6 text-gray-400" />
                  )}
                </div>
                <div>
                  <p className="text-white font-medium">Enable Mesh Networking</p>
                  <p className="text-xs text-gray-400">
                    {settings.enabled ? 'Active - discovering peers' : 'Disabled'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleToggleMesh}
                disabled={isEnabling}
                className="relative"
              >
                {isEnabling ? (
                  <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                ) : settings.enabled ? (
                  <ToggleRight className="w-12 h-12 text-green-400" />
                ) : (
                  <ToggleLeft className="w-12 h-12 text-gray-500" />
                )}
              </button>
            </div>
          </div>

          {/* Status Section */}
          {settings.enabled && (
            <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Network Status</h3>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-700/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-white">{status.connectedPeers}</p>
                  <p className="text-xs text-gray-400">Connected</p>
                </div>
                <div className="bg-gray-700/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-white">{status.discoveredPeers}</p>
                  <p className="text-xs text-gray-400">Discovered</p>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Server Status</span>
                <span className={status.isOnline ? 'text-green-400' : 'text-red-400'}>
                  {status.isOnline ? '● Online' : '● Offline (Mesh Mode)'}
                </span>
              </div>

              {status.queuedMessages > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Queued Messages</span>
                  <span className="text-yellow-400">{status.queuedMessages}</span>
                </div>
              )}

              {status.bleScanning && (
                <div className="flex items-center gap-2 text-sm text-blue-400">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Scanning for devices...</span>
                </div>
              )}
            </div>
          )}

          {/* Permissions Section (Native only) */}
          {isNative && (
            <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Permissions Required</h3>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bluetooth className="w-5 h-5 text-blue-400" />
                  <span className="text-sm text-gray-300">Bluetooth</span>
                </div>
                {permissions.bluetooth ? (
                  <CheckCircle className="w-5 h-5 text-green-400" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-red-400" />
                  <span className="text-sm text-gray-300">Location</span>
                </div>
                {permissions.location ? (
                  <CheckCircle className="w-5 h-5 text-green-400" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                )}
              </div>

              <p className="text-xs text-gray-500 flex items-start gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  Location permission is required by Android for Bluetooth scanning. 
                  BlockStar Cypher does not track or store your location.
                </span>
              </p>
            </div>
          )}

          {/* Connection Methods */}
          {settings.enabled && (
            <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Connection Methods</h3>
              
              {/* BLE Toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bluetooth className="w-5 h-5 text-blue-400" />
                  <div>
                    <p className="text-sm text-white">Bluetooth Low Energy</p>
                    <p className="text-xs text-gray-400">Range: ~30 meters</p>
                  </div>
                </div>
                <button onClick={handleToggleBLE}>
                  {settings.bleEnabled ? (
                    <ToggleRight className="w-10 h-10 text-blue-400" />
                  ) : (
                    <ToggleLeft className="w-10 h-10 text-gray-500" />
                  )}
                </button>
              </div>

              {/* WiFi Direct Toggle */}
              <div className="flex items-center justify-between opacity-50">
                <div className="flex items-center gap-3">
                  <Wifi className="w-5 h-5 text-green-400" />
                  <div>
                    <p className="text-sm text-white">WiFi Direct</p>
                    <p className="text-xs text-gray-400">Range: ~200 meters (Coming soon)</p>
                  </div>
                </div>
                <button onClick={handleToggleWifiDirect} disabled>
                  {settings.wifiDirectEnabled ? (
                    <ToggleRight className="w-10 h-10 text-green-400" />
                  ) : (
                    <ToggleLeft className="w-10 h-10 text-gray-500" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Advanced Settings */}
          {settings.enabled && (
            <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Advanced Settings</h3>
              
              {/* Auto Connect */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5 text-purple-400" />
                  <div>
                    <p className="text-sm text-white">Auto Connect</p>
                    <p className="text-xs text-gray-400">Automatically connect to discovered peers</p>
                  </div>
                </div>
                <button onClick={handleToggleAutoConnect}>
                  {settings.autoConnect ? (
                    <ToggleRight className="w-10 h-10 text-purple-400" />
                  ) : (
                    <ToggleLeft className="w-10 h-10 text-gray-500" />
                  )}
                </button>
              </div>

              {/* Hybrid Mode */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Zap className="w-5 h-5 text-yellow-400" />
                  <div>
                    <p className="text-sm text-white">Hybrid Mode</p>
                    <p className="text-xs text-gray-400">Auto-switch between internet & mesh</p>
                  </div>
                </div>
                <button onClick={handleToggleHybridMode}>
                  {settings.hybridMode ? (
                    <ToggleRight className="w-10 h-10 text-yellow-400" />
                  ) : (
                    <ToggleLeft className="w-10 h-10 text-gray-500" />
                  )}
                </button>
              </div>

              {/* Store & Forward */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <RefreshCw className="w-5 h-5 text-cyan-400" />
                  <div>
                    <p className="text-sm text-white">Store & Forward</p>
                    <p className="text-xs text-gray-400">Queue messages for offline peers</p>
                  </div>
                </div>
                <button onClick={handleToggleStoreForward}>
                  {settings.storeAndForward ? (
                    <ToggleRight className="w-10 h-10 text-cyan-400" />
                  ) : (
                    <ToggleLeft className="w-10 h-10 text-gray-500" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Battery Warning */}
          {settings.enabled && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Battery className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-yellow-200 font-medium">Battery Usage</p>
                  <p className="text-xs text-yellow-200/70 mt-1">
                    Mesh networking uses Bluetooth scanning which can increase battery usage. 
                    Disable when you have reliable internet to save battery.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Info Section */}
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="w-full bg-gray-800/50 rounded-xl p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Info className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-300">How Mesh Networking Works</span>
            </div>
            <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${showInfo ? 'rotate-90' : ''}`} />
          </button>

          {showInfo && (
            <div className="bg-gray-800/30 rounded-xl p-4 space-y-3 text-sm text-gray-300">
              <p>
                <strong className="text-white">📶 No Internet Needed:</strong> Communicate when WiFi and cellular are unavailable.
              </p>
              <p>
                <strong className="text-white">🔗 Device-to-Device:</strong> Connect directly via Bluetooth or WiFi Direct.
              </p>
              <p>
                <strong className="text-white">🌐 Multi-Hop Routing:</strong> Messages can relay through nearby devices to reach recipients further away.
              </p>
              <p>
                <strong className="text-white">🔒 Still Encrypted:</strong> End-to-end encryption is maintained even in mesh mode.
              </p>
              <p className="text-gray-400 text-xs">
                Perfect for music festivals, conferences, outdoor events, or emergency situations where internet is unavailable.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
