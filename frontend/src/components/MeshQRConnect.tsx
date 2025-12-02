// frontend/src/components/MeshQRConnect.tsx
// QR Code based peer-to-peer connection for offline mesh networking

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { QrCode, Camera, X, Check, Loader2, Wifi, WifiOff, Users, RefreshCw } from 'lucide-react';
import { meshNetworkService, ConnectionOffer, MeshPeer } from '@/lib/mesh/MeshNetworkService';
import QRCode from 'qrcode';

interface MeshQRConnectProps {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: string;
  publicKey: string;
  username?: string;
}

type ConnectionStep = 'choose' | 'show-offer' | 'scan-offer' | 'show-answer' | 'scan-answer' | 'connected';

export const MeshQRConnect: React.FC<MeshQRConnectProps> = ({
  isOpen,
  onClose,
  walletAddress,
  publicKey,
  username,
}) => {
  const [step, setStep] = useState<ConnectionStep>('choose');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrData, setQrData] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [connectedPeer, setConnectedPeer] = useState<MeshPeer | null>(null);
  const [scannedData, setScannedData] = useState<string>('');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize mesh service if needed
  useEffect(() => {
    if (isOpen && walletAddress && publicKey) {
      meshNetworkService.initialize(walletAddress, publicKey, username);
    }
  }, [isOpen, walletAddress, publicKey, username]);

  // Cleanup on close
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setStep('choose');
      setQrDataUrl('');
      setQrData('');
      setError('');
      setScannedData('');
    }
  }, [isOpen]);

  // Generate QR code image from data
  const generateQRImage = async (data: string): Promise<string> => {
    try {
      return await QRCode.toDataURL(data, {
        width: 300,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
    } catch (err) {
      console.error('Failed to generate QR code:', err);
      throw err;
    }
  };

  // Start as initiator - create offer
  const startAsInitiator = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      const { qrData: offerData } = await meshNetworkService.createConnectionOffer();
      setQrData(offerData);
      const imageUrl = await generateQRImage(offerData);
      setQrDataUrl(imageUrl);
      setStep('show-offer');
    } catch (err: any) {
      setError(err.message || 'Failed to create connection offer');
    } finally {
      setIsLoading(false);
    }
  };

  // Start as joiner - scan offer
  const startAsJoiner = () => {
    setStep('scan-offer');
    startCamera();
  };

  // Camera handling
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        startScanning();
      }
    } catch (err: any) {
      setError('Camera access denied. Please allow camera access to scan QR codes.');
    }
  };

  const stopCamera = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  // QR Code scanning using canvas
  const startScanning = () => {
    if (scanIntervalRef.current) return;
    
    scanIntervalRef.current = setInterval(() => {
      scanQRCode();
    }, 500);
  };

  const scanQRCode = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) return;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    
    try {
      // Use BarcodeDetector if available
      if ('BarcodeDetector' in window) {
        const barcodeDetector = new (window as any).BarcodeDetector({
          formats: ['qr_code'],
        });
        
        const barcodes = await barcodeDetector.detect(canvas);
        
        if (barcodes.length > 0) {
          const data = barcodes[0].rawValue;
          handleScannedData(data);
        }
      }
    } catch (err) {
      // BarcodeDetector not supported, need to use jsQR library
      // For now, allow manual input
    }
  };

  const handleScannedData = async (data: string) => {
    stopCamera();
    setScannedData(data);
    setIsLoading(true);
    setError('');
    
    try {
      if (step === 'scan-offer') {
        // We scanned an offer, create answer
        const { qrData: answerData } = await meshNetworkService.acceptConnectionOffer(data);
        setQrData(answerData);
        const imageUrl = await generateQRImage(answerData);
        setQrDataUrl(imageUrl);
        setStep('show-answer');
      } else if (step === 'scan-answer') {
        // We scanned an answer, complete connection
        await meshNetworkService.completeConnection(data);
        setStep('connected');
        
        // Get connected peer info
        const peers = meshNetworkService.getConnectedPeers();
        if (peers.length > 0) {
          setConnectedPeer(peers[peers.length - 1]);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to process QR code');
      // Go back to scanning
      if (step === 'scan-offer') {
        startCamera();
      }
    } finally {
      setIsLoading(false);
    }
  };

  // After showing offer, wait for answer
  const proceedToScanAnswer = () => {
    setStep('scan-answer');
    startCamera();
  };

  // Manual input fallback
  const handleManualInput = () => {
    const data = prompt('Paste the QR code data:');
    if (data) {
      handleScannedData(data);
    }
  };

  // Copy QR data to clipboard
  const copyQRData = () => {
    navigator.clipboard.writeText(qrData);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center">
              <Wifi className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Mesh Connect</h2>
              <p className="text-sm text-gray-400">Connect directly via QR code</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Step: Choose role */}
          {step === 'choose' && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-16 h-16 bg-purple-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-purple-400" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">
                  Connect Without Internet
                </h3>
                <p className="text-gray-400 text-sm">
                  Create a direct peer-to-peer connection using QR codes.
                  No server needed!
                </p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={startAsInitiator}
                  disabled={isLoading}
                  className="w-full py-4 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 rounded-xl text-white font-medium flex items-center justify-center gap-3 transition-colors"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <QrCode className="w-5 h-5" />
                  )}
                  Show My QR Code
                </button>

                <button
                  onClick={startAsJoiner}
                  disabled={isLoading}
                  className="w-full py-4 px-4 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-700/50 rounded-xl text-white font-medium flex items-center justify-center gap-3 transition-colors"
                >
                  <Camera className="w-5 h-5" />
                  Scan QR Code
                </button>
              </div>

              {error && (
                <p className="text-red-400 text-sm text-center">{error}</p>
              )}
            </div>
          )}

          {/* Step: Show offer QR */}
          {step === 'show-offer' && (
            <div className="space-y-6">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-white mb-2">
                  Step 1: Show This QR Code
                </h3>
                <p className="text-gray-400 text-sm">
                  Have the other person scan this code
                </p>
              </div>

              {qrDataUrl && (
                <div className="bg-white p-4 rounded-xl mx-auto w-fit">
                  <img src={qrDataUrl} alt="Connection QR Code" className="w-64 h-64" />
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={copyQRData}
                  className="flex-1 py-3 px-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-white text-sm flex items-center justify-center gap-2"
                >
                  Copy Data
                </button>
                <button
                  onClick={proceedToScanAnswer}
                  className="flex-1 py-3 px-4 bg-purple-600 hover:bg-purple-700 rounded-xl text-white text-sm flex items-center justify-center gap-2"
                >
                  Next: Scan Response
                </button>
              </div>

              <p className="text-gray-500 text-xs text-center">
                After they scan, they'll show you a response QR code
              </p>
            </div>
          )}

          {/* Step: Scan offer */}
          {step === 'scan-offer' && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-white mb-2">
                  Scan Their QR Code
                </h3>
                <p className="text-gray-400 text-sm">
                  Point your camera at their QR code
                </p>
              </div>

              <div className="relative bg-black rounded-xl overflow-hidden aspect-square">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />
                <canvas ref={canvasRef} className="hidden" />
                
                {/* Scanning overlay */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-48 h-48 border-2 border-purple-500 rounded-2xl" />
                </div>

                {isLoading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                  </div>
                )}
              </div>

              <button
                onClick={handleManualInput}
                className="w-full py-3 px-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-white text-sm"
              >
                Paste Data Manually
              </button>

              {error && (
                <p className="text-red-400 text-sm text-center">{error}</p>
              )}
            </div>
          )}

          {/* Step: Show answer QR */}
          {step === 'show-answer' && (
            <div className="space-y-6">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-white mb-2">
                  Step 2: Show Your Response
                </h3>
                <p className="text-gray-400 text-sm">
                  Have them scan this code to complete connection
                </p>
              </div>

              {qrDataUrl && (
                <div className="bg-white p-4 rounded-xl mx-auto w-fit">
                  <img src={qrDataUrl} alt="Response QR Code" className="w-64 h-64" />
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={copyQRData}
                  className="flex-1 py-3 px-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-white text-sm"
                >
                  Copy Data
                </button>
              </div>

              <p className="text-gray-500 text-xs text-center">
                Connection will complete automatically when they scan
              </p>

              {isLoading && (
                <div className="flex items-center justify-center gap-2 text-purple-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Waiting for connection...</span>
                </div>
              )}
            </div>
          )}

          {/* Step: Scan answer */}
          {step === 'scan-answer' && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-white mb-2">
                  Step 2: Scan Their Response
                </h3>
                <p className="text-gray-400 text-sm">
                  Point your camera at their response QR code
                </p>
              </div>

              <div className="relative bg-black rounded-xl overflow-hidden aspect-square">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />
                <canvas ref={canvasRef} className="hidden" />
                
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-48 h-48 border-2 border-purple-500 rounded-2xl" />
                </div>

                {isLoading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                  </div>
                )}
              </div>

              <button
                onClick={handleManualInput}
                className="w-full py-3 px-4 bg-gray-700 hover:bg-gray-600 rounded-xl text-white text-sm"
              >
                Paste Data Manually
              </button>

              {error && (
                <p className="text-red-400 text-sm text-center">{error}</p>
              )}
            </div>
          )}

          {/* Step: Connected! */}
          {step === 'connected' && (
            <div className="space-y-6 text-center">
              <div className="w-20 h-20 bg-green-600/20 rounded-full flex items-center justify-center mx-auto">
                <Check className="w-10 h-10 text-green-500" />
              </div>

              <div>
                <h3 className="text-xl font-semibold text-white mb-2">
                  Connected!
                </h3>
                <p className="text-gray-400 text-sm">
                  You can now message directly without a server
                </p>
              </div>

              {connectedPeer && (
                <div className="bg-gray-800 rounded-xl p-4">
                  <p className="text-sm text-gray-400 mb-1">Connected to:</p>
                  <p className="text-white font-mono text-sm break-all">
                    {connectedPeer.username || connectedPeer.walletAddress}
                  </p>
                </div>
              )}

              <button
                onClick={onClose}
                className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 rounded-xl text-white font-medium"
              >
                Start Chatting
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MeshQRConnect;
