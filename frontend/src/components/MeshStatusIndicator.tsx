// frontend/src/components/MeshStatusIndicator.tsx
// Header indicator showing mesh network status and peer count
// FIXED: Now shows "Enable Mesh" button when disabled

'use client';

import React, { useState, useEffect } from 'react';
import { Radio, Wifi, WifiOff, Users, Loader2, Settings } from 'lucide-react';
import { meshNetworkService, MeshNetworkStatus } from '@/lib/mesh/MeshNetworkService';

interface MeshStatusIndicatorProps {
  onClick?: () => void;
  onOpenSettings?: () => void;
  className?: string;
}

export default function MeshStatusIndicator({ 
  onClick, 
  onOpenSettings,
  className = '' 
}: MeshStatusIndicatorProps) {
  const [status, setStatus] = useState<MeshNetworkStatus | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    // Get initial status
    setStatus(meshNetworkService.getStatus());
    
    // Subscribe to status changes
    const unsubscribe = meshNetworkService.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    return () => unsubscribe();
  }, []);

  // Show "Enable Mesh" button when disabled (instead of hiding completely)
  if (!status?.enabled) {
    return (
      <button
        onClick={onOpenSettings || onClick}
        className={`
          flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium
          bg-gray-700/30 text-gray-400 hover:bg-gray-700/50 hover:text-gray-300
          transition-colors ${className}
        `}
        title="Enable Mesh Networking"
      >
        <Radio className="w-3.5 h-3.5" />
        <span>Mesh Off</span>
      </button>
    );
  }

  const totalPeers = status.connectedPeers + status.discoveredPeers;
  const isScanning = status.bleScanning;
  const isMeshMode = status.isMeshMode;

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`
          flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium
          transition-colors
          ${isMeshMode 
            ? 'bg-purple-500/20 text-purple-300' 
            : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
          }
        `}
      >
        {/* Mesh Icon */}
        {isScanning ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isMeshMode ? (
          <Radio className="w-3.5 h-3.5 text-purple-400" />
        ) : (
          <Radio className="w-3.5 h-3.5" />
        )}

        {/* Connection Status */}
        {!status.isOnline && (
          <WifiOff className="w-3 h-3 text-red-400" />
        )}

        {/* Peer Count */}
        <span className="tabular-nums">
          {status.connectedPeers}
          {status.discoveredPeers > 0 && (
            <span className="text-gray-500">+{status.discoveredPeers}</span>
          )}
        </span>

        {/* Live indicator when scanning */}
        {isScanning && (
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
        )}
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl min-w-[180px]">
            <div className="text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Status</span>
                <span className={isMeshMode ? 'text-purple-400' : 'text-green-400'}>
                  {isMeshMode ? 'Mesh Mode' : 'Online'}
                </span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Connected</span>
                <span className="text-white">{status.connectedPeers} peers</span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Discovered</span>
                <span className="text-white">{status.discoveredPeers} peers</span>
              </div>

              {status.queuedMessages > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Queued</span>
                  <span className="text-yellow-400">{status.queuedMessages} messages</span>
                </div>
              )}

              {isScanning && (
                <div className="flex items-center gap-1 text-blue-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Scanning...</span>
                </div>
              )}

              <div className="pt-2 border-t border-gray-700 text-gray-500 text-center">
                Click to open mesh settings
              </div>
            </div>
          </div>
          {/* Arrow */}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 border-l border-t border-gray-700 rotate-45" />
        </div>
      )}
    </div>
  );
}

// Compact version for mobile
export function MeshStatusBadge({ onClick }: { onClick?: () => void }) {
  const [status, setStatus] = useState<MeshNetworkStatus | null>(null);

  useEffect(() => {
    setStatus(meshNetworkService.getStatus());
    const unsubscribe = meshNetworkService.onStatusChange(setStatus);
    return () => unsubscribe();
  }, []);

  // Show disabled state instead of hiding
  if (!status?.enabled) {
    return (
      <button
        onClick={onClick}
        className="relative p-2 rounded-full bg-gray-700/30"
        title="Enable Mesh"
      >
        <Radio className="w-5 h-5 text-gray-500" />
      </button>
    );
  }

  const isMeshMode = status.isMeshMode;
  const isScanning = status.bleScanning;

  return (
    <button
      onClick={onClick}
      className={`
        relative p-2 rounded-full
        ${isMeshMode ? 'bg-purple-500/20' : 'bg-gray-700/50'}
      `}
    >
      {isScanning ? (
        <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
      ) : (
        <Radio className={`w-5 h-5 ${isMeshMode ? 'text-purple-400' : 'text-gray-400'}`} />
      )}
      
      {/* Peer count badge */}
      {status.connectedPeers > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-purple-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
          {status.connectedPeers}
        </span>
      )}

      {/* Scanning pulse */}
      {isScanning && (
        <span className="absolute inset-0 rounded-full bg-purple-400/30 animate-ping" />
      )}
    </button>
  );
}
