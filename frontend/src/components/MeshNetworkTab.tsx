// frontend/src/components/MeshNetworkTab.tsx
// Complete Mesh Network tab with all features

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import jsQR from 'jsqr';
import {
  Radio,
  QrCode,
  ScanLine,
  Users,
  User,
  Wifi,
  WifiOff,
  Bluetooth,
  Settings,
  RefreshCw,
  Send,
  MessageSquare,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  Signal,
  SignalLow,
  SignalMedium,
  SignalHigh,
  X,
  Copy,
  Camera,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { meshNetworkService, MeshPeer, MeshNetworkStatus, MeshMessage } from '@/lib/mesh/MeshNetworkService';
import MeshSettingsComponent from './MeshSettings';
import { useAppStore } from '@/store';

interface MeshNetworkTabProps {
  walletAddress: string;
  publicKey: string | Uint8Array;
  username?: string;
  avatar?: string;
}

type TabView = 'overview' | 'peers' | 'qr-connect' | 'messages';

export default function MeshNetworkTab({
  walletAddress,
  publicKey,
  username,
  avatar,
}: MeshNetworkTabProps) {
  const [status, setStatus] = useState<MeshNetworkStatus | null>(null);
  const [peers, setPeers] = useState<MeshPeer[]>([]);
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [activeTab, setActiveTab] = useState<TabView>('overview');
  const [showSettings, setShowSettings] = useState(false);
  const [qrMode, setQrMode] = useState<'none' | 'generate' | 'scan'>('none');
  const [qrData, setQrData] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [scannedData, setScannedData] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [responseQR, setResponseQR] = useState('');
  const [responseQRReady, setResponseQRReady] = useState(false);
  const [error, setError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'starting' | 'active' | 'denied' | 'unavailable'>('idle');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanRafRef = useRef<number | null>(null);
  const responseQRRef = useRef<HTMLDivElement>(null);

  // Initialize mesh service
  useEffect(() => {
    meshNetworkService.initialize(walletAddress, publicKey, username, avatar);

    // Subscribe to updates
    const unsubStatus = meshNetworkService.onStatusChange(setStatus);
    const unsubPeer = meshNetworkService.onPeerChange((peer, event) => {
      setPeers(meshNetworkService.getAllPeers());
    });
    const unsubMessage = meshNetworkService.onMessage((message, peer) => {
      setMessages(prev => [message, ...prev].slice(0, 100));
    });

    // Initial peer list
    setPeers(meshNetworkService.getAllPeers());

    return () => {
      unsubStatus();
      unsubPeer();
      unsubMessage();
    };
  }, [walletAddress, publicKey, username, avatar]);

  // Generate QR code
  const handleGenerateQR = async () => {
    setIsGenerating(true);
    setError('');
    try {
      const result = await meshNetworkService.createConnectionOffer();
      setQrData(result.qrData);
      setQrMode('generate');
    } catch (e: any) {
      setError(e.message || 'Failed to generate QR code');
    } finally {
      setIsGenerating(false);
    }
  };

  // Process scanned/pasted QR data (shared by camera auto-detect and manual paste)
  const processQRData = async (data: string) => {
    if (!data.trim()) {
      setError('Please enter QR data');
      return;
    }

    setIsProcessing(true);
    setError('');

    try {
      // Check if it's an offer or answer
      if (data.includes('"t":"o"') || data.includes('"t": "o"') ||
          (data.startsWith('BSM1:') && atob(data.slice(5)).includes('"t":"o"'))) {
        // It's an offer, generate answer
        const result = await meshNetworkService.processScannedOffer(data);
        if (result) {
          setResponseQR(result.qrData);
          setResponseQRReady(true);
          setScannedData('');
        } else {
          setError('Failed to process offer');
        }
      } else {
        // It's an answer
        const success = await meshNetworkService.processScannedAnswer(data);
        if (success) {
          setQrMode('none');
          setScannedData('');
          setActiveTab('peers');
        } else {
          setError('Failed to process answer');
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to process QR data');
    } finally {
      setIsProcessing(false);
    }
  };

  // Manual "Process QR Data" button
  const handleProcessScan = () => processQRData(scannedData);

  // ------------------------------------------------------------------
  // Camera scanning (getUserMedia + jsQR). jsQR is used instead of the
  // browser BarcodeDetector API because BarcodeDetector isn't available on
  // Safari/iOS/macOS, which was why "Scan QR" previously offered no camera
  // option at all on those platforms.
  // ------------------------------------------------------------------
  const stopCamera = useCallback(() => {
    if (scanRafRef.current !== null) {
      cancelAnimationFrame(scanRafRef.current);
      scanRafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });

          if (code && code.data) {
            stopCamera();
            setCameraStatus('idle');
            setScannedData(code.data);
            void processQRData(code.data);
            return;
          }
        } catch {
          // Ignore transient decode errors and keep scanning
        }
      }
    }

    scanRafRef.current = requestAnimationFrame(scanFrame);
  }, [stopCamera]);

  const startCamera = useCallback(async () => {
    setCameraError('');
    setCameraStatus('starting');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraStatus('unavailable');
      setCameraError('Camera not supported in this browser. Paste the QR data below instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraStatus('active');
      scanRafRef.current = requestAnimationFrame(scanFrame);
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setCameraStatus('denied');
        setCameraError('Camera access denied. Enable camera access in your browser/system settings, or paste the QR data below.');
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        setCameraStatus('unavailable');
        setCameraError('No camera found. Paste the QR data below instead.');
      } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
        setCameraStatus('unavailable');
        setCameraError('Camera is in use by another app. Close it, then try again.');
      } else if (err?.name === 'OverconstrainedError') {
        // Retry without facingMode (common on desktop webcams)
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
          }
          setCameraStatus('active');
          scanRafRef.current = requestAnimationFrame(scanFrame);
        } catch {
          setCameraStatus('unavailable');
          setCameraError('Could not access camera. Paste the QR data below instead.');
        }
      } else {
        setCameraStatus('unavailable');
        setCameraError('Could not access camera. Paste the QR data below instead.');
      }
    }
  }, [scanFrame]);

  // Start the camera whenever we enter scan mode; stop it whenever we leave
  // scan mode or the tab unmounts.
  useEffect(() => {
    if (qrMode === 'scan') {
      setResponseQR('');
      setResponseQRReady(false);
      startCamera();
    } else {
      stopCamera();
      setResponseQR('');
      setResponseQRReady(false);
    }
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrMode]);

  // When a response QR is freshly generated, scroll it into view so the
  // success isn't missed just because it renders below the fold.
  useEffect(() => {
    if (responseQRReady && responseQRRef.current) {
      responseQRRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const t = setTimeout(() => setResponseQRReady(false), 4000);
      return () => clearTimeout(t);
    }
  }, [responseQRReady]);

  // If a peer finishes connecting while we're still sitting on the
  // Connect/Scan screen, jump back to the Peers list automatically. Without
  // this, connectionState changes landed in the `peers` array (once
  // onPeerChange fired) but nothing moved the user off the QR view, so it
  // looked like nothing had happened until they closed and reopened the
  // whole modal, which remounted the component and refetched the list.
  const prevConnectedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentConnectedIds = new Set(
      peers.filter(p => p.connectionState === 'connected').map(p => p.id)
    );
    const justConnected = [...currentConnectedIds].some(id => !prevConnectedIdsRef.current.has(id));
    prevConnectedIdsRef.current = currentConnectedIds;

    if (justConnected && qrMode !== 'none') {
      setQrMode('none');
      setScannedData('');
      setResponseQR('');
      setResponseQRReady(false);
      setActiveTab('peers');
    }
  }, [peers, qrMode]);

  // Copy QR data
  const handleCopyQR = () => {
    navigator.clipboard.writeText(qrData || responseQR);
  };

  // Get signal strength icon
  const getSignalIcon = (peer: MeshPeer) => {
    if (peer.rssi === undefined) return <Signal className="w-4 h-4 text-gray-400" />;
    if (peer.rssi >= -50) return <SignalHigh className="w-4 h-4 text-green-400" />;
    if (peer.rssi >= -70) return <SignalMedium className="w-4 h-4 text-yellow-400" />;
    return <SignalLow className="w-4 h-4 text-red-400" />;
  };

  // Get connection type icon
  const getConnectionIcon = (type: MeshPeer['connectionType']) => {
    switch (type) {
      case 'ble': return <Bluetooth className="w-4 h-4 text-blue-400" />;
      case 'wifi-direct': return <Wifi className="w-4 h-4 text-green-400" />;
      default: return <Radio className="w-4 h-4 text-purple-400" />;
    }
  };

  // Render overview tab
  const renderOverview = () => (
    <div className="space-y-4">
      {/* Status Card */}
      <div className="bg-gray-800/50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-300">Network Status</h3>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-gray-700 rounded-lg"
          >
            <Settings className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {status?.enabled ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${status.isOnline ? 'bg-green-400' : 'bg-purple-400'}`} />
              <span className="text-white">
                {status.isOnline ? 'Online' : 'Mesh Mode (Offline)'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gray-700/50 rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-white">{status.connectedPeers}</p>
                <p className="text-xs text-gray-400">Connected</p>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-white">{status.discoveredPeers}</p>
                <p className="text-xs text-gray-400">Nearby</p>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-white">{status.queuedMessages}</p>
                <p className="text-xs text-gray-400">Queued</p>
              </div>
            </div>

            {status.bleScanning && (
              <div className="flex items-center gap-2 text-sm text-blue-400">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Scanning for nearby devices...</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4">
            <Radio className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 mb-3">Mesh networking is disabled</p>
            <button
              onClick={() => setShowSettings(true)}
              className="px-4 py-2 bg-purple-500 hover:bg-purple-600 rounded-lg text-white text-sm"
            >
              Enable Mesh Network
            </button>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      {status?.enabled && (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => { setActiveTab('qr-connect'); setQrMode('generate'); handleGenerateQR(); }}
            className="bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-4 text-left"
          >
            <QrCode className="w-8 h-8 text-purple-400 mb-2" />
            <p className="text-white font-medium">Share My QR</p>
            <p className="text-xs text-gray-400">Let others connect to you</p>
          </button>
          
          <button
            onClick={() => { setActiveTab('qr-connect'); setQrMode('scan'); }}
            className="bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-4 text-left"
          >
            <ScanLine className="w-8 h-8 text-blue-400 mb-2" />
            <p className="text-white font-medium">Scan QR Code</p>
            <p className="text-xs text-gray-400">Connect to a peer</p>
          </button>
        </div>
      )}

      {/* Connected Peers Preview */}
      {peers.filter(p => p.connectionState === 'connected').length > 0 && (
        <div className="bg-gray-800/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-300">Connected Peers</h3>
            <button
              onClick={() => setActiveTab('peers')}
              className="text-xs text-purple-400 hover:text-purple-300"
            >
              View All
            </button>
          </div>
          <div className="space-y-2">
            {peers.filter(p => p.connectionState === 'connected').slice(0, 3).map(peer => (
              <div
                key={peer.walletAddress}
                className="flex items-center gap-3 p-2 bg-gray-700/50 rounded-lg"
              >
                <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <User className="w-4 h-4 text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">
                    {peer.username || `${peer.walletAddress.slice(0, 8)}...`}
                  </p>
                  <p className="text-xs text-gray-400">
                    {peer.distance > 0 ? `~${peer.distance}m away` : 'Connected'}
                  </p>
                </div>
                {getSignalIcon(peer)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // Render peers tab
  const renderPeers = () => {
    const connected = peers.filter(p => p.connectionState === 'connected');
    const discovered = peers.filter(p => p.connectionState !== 'connected');

    return (
      <div className="space-y-4">
        {/* Connected Peers */}
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-400" />
            Connected ({connected.length})
          </h3>
          {connected.length > 0 ? (
            <div className="space-y-2">
              {connected.map(peer => (
                <div
                  key={peer.walletAddress}
                  className="bg-gray-800/50 rounded-xl p-3 flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                    {peer.avatar ? (
                      <img src={peer.avatar} className="w-10 h-10 rounded-full" />
                    ) : (
                      <User className="w-5 h-5 text-green-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">
                      {peer.username || `${peer.walletAddress.slice(0, 8)}...${peer.walletAddress.slice(-4)}`}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      {getConnectionIcon(peer.connectionType)}
                      <span>{peer.connectionType.toUpperCase()}</span>
                      {peer.distance > 0 && <span>• ~{peer.distance}m</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getSignalIcon(peer)}
                    <button className="p-2 hover:bg-gray-700 rounded-lg">
                      <MessageSquare className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4">No connected peers</p>
          )}
        </div>

        {/* Discovered Peers */}
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
            <Radio className="w-4 h-4 text-purple-400" />
            Discovered ({discovered.length})
          </h3>
          {discovered.length > 0 ? (
            <div className="space-y-2">
              {discovered.map(peer => (
                <div
                  key={peer.walletAddress}
                  className="bg-gray-800/50 rounded-xl p-3 flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                    {peer.avatar ? (
                      <img src={peer.avatar} className="w-10 h-10 rounded-full" />
                    ) : (
                      <User className="w-5 h-5 text-purple-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">
                      {peer.username || `${peer.walletAddress.slice(0, 8)}...`}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      {getConnectionIcon(peer.connectionType)}
                      <span>~{peer.distance}m away</span>
                      <span className={
                        peer.connectionState === 'connecting' ? 'text-yellow-400' : 'text-gray-500'
                      }>
                        • {peer.connectionState}
                      </span>
                    </div>
                  </div>
                  {peer.connectionState === 'connecting' ? (
                    <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
                  ) : (
                    <button className="px-3 py-1 bg-purple-500/20 hover:bg-purple-500/30 rounded-lg text-purple-300 text-sm">
                      Connect
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4">
              {status?.bleScanning ? (
                <div className="flex items-center justify-center gap-2 text-gray-400">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Scanning for nearby devices...</span>
                </div>
              ) : (
                <p className="text-sm text-gray-500">No nearby devices found</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render QR connect
  const renderQRConnect = () => (
    <div className="space-y-4">
      {/* Mode Selection */}
      {qrMode === 'none' && (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleGenerateQR}
            disabled={isGenerating}
            className="bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-6 text-center"
          >
            {isGenerating ? (
              <Loader2 className="w-12 h-12 text-purple-400 mx-auto mb-3 animate-spin" />
            ) : (
              <QrCode className="w-12 h-12 text-purple-400 mx-auto mb-3" />
            )}
            <p className="text-white font-medium">Generate QR</p>
            <p className="text-xs text-gray-400">Share with others</p>
          </button>
          
          <button
            onClick={() => setQrMode('scan')}
            className="bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-6 text-center"
          >
            <ScanLine className="w-12 h-12 text-blue-400 mx-auto mb-3" />
            <p className="text-white font-medium">Scan QR</p>
            <p className="text-xs text-gray-400">Connect to peer</p>
          </button>
        </div>
      )}

      {/* Generate Mode: loading / error fallback so it's never blank */}
      {qrMode === 'generate' && !qrData && (
        <div className="bg-gray-800/50 rounded-xl p-6 text-center">
          {isGenerating ? (
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
              <span className="text-sm">Generating your connection QR…</span>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-red-400 text-sm flex items-center justify-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {error || 'Could not generate QR code'}
              </p>
              <button
                onClick={handleGenerateQR}
                className="px-4 py-2 bg-purple-500 hover:bg-purple-600 rounded-lg text-white text-sm"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Generate Mode */}
      {qrMode === 'generate' && qrData && (
        <div className="bg-gray-800/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-medium">Your Connection QR</h3>
            <button
              onClick={() => { setQrMode('none'); setQrData(''); }}
              className="p-1 hover:bg-gray-700 rounded"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
          
          <div className="bg-white rounded-xl p-4 mb-4">
            <QRCodeSVG value={qrData} size={200} className="mx-auto" />
          </div>
          
          <p className="text-sm text-gray-400 text-center mb-3">
            Have the other person scan this QR code, then scan their response
          </p>
          
          <div className="flex gap-2">
            <button
              onClick={handleCopyQR}
              className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-sm flex items-center justify-center gap-2"
            >
              <Copy className="w-4 h-4" />
              Copy Data
            </button>
            <button
              onClick={() => setQrMode('scan')}
              className="flex-1 py-2 bg-purple-500 hover:bg-purple-600 rounded-lg text-white text-sm flex items-center justify-center gap-2"
            >
              <ScanLine className="w-4 h-4" />
              Scan Response
            </button>
          </div>
        </div>
      )}

      {/* Scan Mode */}
      {qrMode === 'scan' && (
        <div className="bg-gray-800/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-medium">Scan QR Code</h3>
            <button
              onClick={() => { setQrMode('none'); setScannedData(''); setResponseQR(''); }}
              className="p-1 hover:bg-gray-700 rounded"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Live camera preview + QR auto-detect (falls back to paste below) */}
          <div className="relative bg-gray-900 rounded-xl aspect-square flex items-center justify-center mb-4 overflow-hidden">
            {(cameraStatus === 'denied' || cameraStatus === 'unavailable') ? (
              <div className="text-center p-4">
                <Camera className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400 text-sm mb-3">
                  {cameraStatus === 'denied' ? 'Camera access needed' : 'Camera not available'}
                </p>
                <button
                  onClick={startCamera}
                  className="py-2 px-4 bg-purple-600 hover:bg-purple-700 rounded-lg text-white text-sm inline-flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try Again
                </button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />
                <canvas ref={canvasRef} className="hidden" />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-2/3 h-2/3 border-2 border-purple-500 rounded-2xl" />
                </div>
                {cameraStatus === 'starting' && (
                  <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center">
                    <Loader2 className="w-8 h-8 text-purple-400 animate-spin mb-2" />
                    <p className="text-gray-300 text-sm">Requesting camera access…</p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-3">
            {cameraError && (
              <p className="text-yellow-400 text-xs text-center">{cameraError}</p>
            )}

            <textarea
              value={scannedData}
              onChange={(e) => setScannedData(e.target.value)}
              placeholder="Or paste QR code data here..."
              className="w-full h-24 bg-gray-700 rounded-lg p-3 text-white text-sm placeholder-gray-500 resize-none"
            />
            
            {error && (
              <p className="text-red-400 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {error}
              </p>
            )}

            <button
              onClick={handleProcessScan}
              disabled={isProcessing || !scannedData.trim()}
              className="w-full py-3 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-600 rounded-lg text-white font-medium flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <CheckCircle className="w-5 h-5" />
                  Process QR Data
                </>
              )}
            </button>
          </div>

          {/* Response QR */}
          {responseQR && (
            <div ref={responseQRRef} className="mt-4 pt-4 border-t border-gray-700">
              {responseQRReady && (
                <div className="mb-3 flex items-center gap-2 text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  <span>QR processed successfully — show this response to complete the connection.</span>
                </div>
              )}
              <h4 className="text-white font-medium mb-3">Your Response QR</h4>
              <p className="text-sm text-gray-400 mb-3">
                Show this to the other person to complete the connection
              </p>
              <div className="bg-white rounded-xl p-4 mb-3">
                <QRCodeSVG value={responseQR} size={180} className="mx-auto" />
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(responseQR)}
                className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-sm"
              >
                Copy Response Data
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // Render messages tab
  const renderMessages = () => (
    <div className="space-y-2">
      {messages.length > 0 ? (
        messages.map(msg => (
          <div
            key={msg.id}
            className={`p-3 rounded-xl ${
              msg.from === walletAddress.toLowerCase()
                ? 'bg-purple-500/20 ml-8'
                : 'bg-gray-800/50 mr-8'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-gray-400">
                {msg.from === walletAddress.toLowerCase() ? 'You' : msg.from.slice(0, 8)}
              </span>
              <span className="text-xs text-gray-500">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
              {msg.hops.length > 1 && (
                <span className="text-xs text-purple-400">
                  ({msg.hops.length - 1} hops)
                </span>
              )}
            </div>
            <p className="text-white text-sm">{msg.content}</p>
          </div>
        ))
      ) : (
        <div className="text-center py-8 text-gray-500">
          <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No mesh messages yet</p>
          <p className="text-xs">Messages sent via mesh will appear here</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Tab Navigation */}
      <div className="flex border-b border-gray-800 px-2">
        {[
          { id: 'overview', label: 'Overview', icon: Radio },
          { id: 'peers', label: 'Peers', icon: Users },
          { id: 'qr-connect', label: 'Connect', icon: QrCode },
          { id: 'messages', label: 'Messages', icon: MessageSquare },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabView)}
            className={`flex-1 py-3 text-xs font-medium flex flex-col items-center gap-1 border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'peers' && renderPeers()}
        {activeTab === 'qr-connect' && renderQRConnect()}
        {activeTab === 'messages' && renderMessages()}
      </div>

      {/* Settings Modal */}
      <MeshSettingsComponent isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
