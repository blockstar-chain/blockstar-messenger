// frontend/src/components/MeshStatusIndicator.tsx
// Shows mesh network status and connected peers

import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Users, Radio, ChevronDown, ChevronUp, QrCode } from 'lucide-react';
import { meshNetworkService, MeshNetworkStatus, MeshPeer } from '@/lib/mesh/MeshNetworkService';

interface MeshStatusIndicatorProps {
  onOpenQRConnect: () => void;
}

export const MeshStatusIndicator: React.FC<MeshStatusIndicatorProps> = ({
  onOpenQRConnect,
}) => {
  const [status, setStatus] = useState<MeshNetworkStatus>({
    isOnline: true,
    isMeshMode: false,
    connectedPeers: 0,
    knownPeers: 0,
    queuedMessages: 0,
    lastServerCheck: Date.now(),
  });
  const [peers, setPeers] = useState<MeshPeer[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    // Subscribe to status changes
    const unsubscribe = meshNetworkService.onStatusChange((newStatus) => {
      setStatus(newStatus);
      setPeers(meshNetworkService.getConnectedPeers());
    });

    // Subscribe to peer changes
    const unsubscribePeers = meshNetworkService.onPeerChange(() => {
      setPeers(meshNetworkService.getConnectedPeers());
    });

    // Initial status
    setStatus(meshNetworkService.getStatus());
    setPeers(meshNetworkService.getConnectedPeers());

    return () => {
      unsubscribe();
      unsubscribePeers();
    };
  }, []);

  const getStatusColor = () => {
    if (!status.isOnline && status.connectedPeers === 0) {
      return 'bg-red-500'; // Offline, no peers
    }
    if (!status.isOnline && status.connectedPeers > 0) {
      return 'bg-yellow-500'; // Offline but has mesh peers
    }
    if (status.isMeshMode) {
      return 'bg-purple-500'; // Mesh mode active
    }
    return 'bg-green-500'; // Online
  };

  const getStatusText = () => {
    if (!status.isOnline && status.connectedPeers === 0) {
      return 'Offline';
    }
    if (!status.isOnline && status.connectedPeers > 0) {
      return 'Mesh Only';
    }
    if (status.isMeshMode) {
      return 'Mesh Active';
    }
    return 'Online';
  };

  const getStatusIcon = () => {
    if (status.isMeshMode || status.connectedPeers > 0) {
      return <Radio className="w-4 h-4" />;
    }
    if (status.isOnline) {
      return <Wifi className="w-4 h-4" />;
    }
    return <WifiOff className="w-4 h-4" />;
  };

  return (
    <div className="relative">
      {/* Main Status Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
          isExpanded ? 'bg-gray-700' : 'hover:bg-gray-700/50'
        }`}
      >
        <div className={`w-2 h-2 rounded-full ${getStatusColor()} animate-pulse`} />
        {getStatusIcon()}
        <span className="text-sm text-gray-300">{getStatusText()}</span>
        {status.connectedPeers > 0 && (
          <span className="flex items-center gap-1 text-xs text-purple-400">
            <Users className="w-3 h-3" />
            {status.connectedPeers}
          </span>
        )}
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {/* Expanded Panel */}
      {isExpanded && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50">
          {/* Header */}
          <div className="p-4 border-b border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white">Network Status</h3>
              <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                status.isOnline 
                  ? 'bg-green-500/20 text-green-400' 
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {status.isOnline ? 'Server Online' : 'Server Offline'}
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-700/50 rounded-lg p-2">
                <p className="text-gray-400 text-xs">Mesh Peers</p>
                <p className="text-white font-semibold">{status.connectedPeers}</p>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-2">
                <p className="text-gray-400 text-xs">Queued Messages</p>
                <p className="text-white font-semibold">{status.queuedMessages}</p>
              </div>
            </div>
          </div>

          {/* Connected Peers */}
          {peers.length > 0 && (
            <div className="p-4 border-b border-gray-700">
              <h4 className="text-sm font-medium text-gray-400 mb-2">Connected Peers</h4>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {peers.map((peer) => (
                  <div
                    key={peer.id}
                    className="flex items-center gap-2 p-2 bg-gray-700/30 rounded-lg"
                  >
                    <div className={`w-2 h-2 rounded-full ${
                      peer.connectionState === 'connected' 
                        ? 'bg-green-500' 
                        : 'bg-yellow-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">
                        {peer.username || 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-500 truncate font-mono">
                        {peer.walletAddress.slice(0, 6)}...{peer.walletAddress.slice(-4)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="p-4">
            <button
              onClick={() => {
                setIsExpanded(false);
                onOpenQRConnect();
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-purple-600 hover:bg-purple-700 rounded-lg text-white text-sm font-medium transition-colors"
            >
              <QrCode className="w-4 h-4" />
              Connect via QR Code
            </button>

            {!status.isOnline && (
              <p className="text-xs text-gray-500 text-center mt-3">
                Server offline. Connect directly using QR codes.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MeshStatusIndicator;
