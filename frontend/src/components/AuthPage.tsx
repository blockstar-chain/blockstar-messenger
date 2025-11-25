import React, { useState } from 'react';
import { useAppStore } from '@/store';
import { blockchainService } from '@/lib/blockchain';
import { encryptionService } from '@/lib/encryption';
import { webSocketService } from '@/lib/websocket';
import { Wallet, Shield, Lock, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AuthPage() {
  const { setCurrentUser, setAuthenticated } = useAppStore();
  const [isConnecting, setIsConnecting] = useState(false);
  const [currentStep, setCurrentStep] = useState<'connect' | 'verify' | 'encrypt'>('connect');

  const handleConnectWallet = async () => {
    setIsConnecting(true);
    
    try {
      setCurrentStep('connect');
      
      // Connect wallet
      const rawAddress = await blockchainService.connectWallet();
      const address = rawAddress.toLowerCase(); // Normalize to lowercase
      toast.success('Wallet connected!');

      setCurrentStep('verify');
      
      // Verify NFT ownership
      const nftMetadata = await blockchainService.verifyNFTOwnership(address);
      
      if (!nftMetadata) {
        toast.error('No @name NFT found. Please purchase an @name NFT to continue.');
        setIsConnecting(false);
        return;
      }

      toast.success(`NFT verified: ${nftMetadata.name}`);

      setCurrentStep('encrypt');
      
      // Initialize encryption
      await encryptionService.initialize(address);
      const publicKey = await encryptionService.getPublicKey();

      // Connect to messaging server
      webSocketService.connect(address, publicKey);

      // Set user in store
      setCurrentUser({
        walletAddress: address,
        username: nftMetadata.name,
        publicKey: publicKey,
        status: 'online',
      });

      setAuthenticated(true);
      toast.success('Successfully authenticated!');
    } catch (error: any) {
      console.error('Authentication error:', error);
      toast.error(error.message || 'Authentication failed');
      setCurrentStep('connect');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-500 via-primary-600 to-primary-700 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white rounded-full mb-4">
            <Shield size={40} className="text-primary-600" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">BlockStar Messenger</h1>
          <p className="text-primary-100">Secure, Decentralized Communication</p>
        </div>

        {/* Auth Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            Connect Your Wallet
          </h2>

          {/* Features */}
          <div className="space-y-4 mb-8">
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${currentStep === 'connect' ? 'bg-primary-100' : 'bg-gray-100'}`}>
                <Wallet size={20} className={currentStep === 'connect' ? 'text-primary-600' : 'text-gray-600'} />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">Connect Wallet</h3>
                <p className="text-sm text-gray-600">Connect your Web3 wallet to get started</p>
              </div>
              {isConnecting && currentStep === 'connect' && (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600"></div>
              )}
            </div>

            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${currentStep === 'verify' ? 'bg-primary-100' : 'bg-gray-100'}`}>
                <CheckCircle size={20} className={currentStep === 'verify' ? 'text-primary-600' : 'text-gray-600'} />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">Verify @name NFT</h3>
                <p className="text-sm text-gray-600">Verify ownership of your @name NFT</p>
              </div>
              {isConnecting && currentStep === 'verify' && (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600"></div>
              )}
            </div>

            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${currentStep === 'encrypt' ? 'bg-primary-100' : 'bg-gray-100'}`}>
                <Lock size={20} className={currentStep === 'encrypt' ? 'text-primary-600' : 'text-gray-600'} />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">Initialize Encryption</h3>
                <p className="text-sm text-gray-600">Set up end-to-end encryption</p>
              </div>
              {isConnecting && currentStep === 'encrypt' && (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600"></div>
              )}
            </div>
          </div>

          {/* Connect Button */}
          <button
            onClick={handleConnectWallet}
            disabled={isConnecting}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold py-4 px-6 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isConnecting ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                Connecting...
              </>
            ) : (
              <>
                <Wallet size={20} />
                Connect Wallet
              </>
            )}
          </button>

          {/* Info */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600 text-center">
              You need an @name NFT to use BlockStar Messenger. Don't have one?{' '}
              <a href="#" className="text-primary-600 hover:text-primary-700 font-semibold">
                Get yours now
              </a>
            </p>
          </div>
        </div>

        {/* Security Info */}
        <div className="mt-6 text-center">
          <p className="text-primary-100 text-sm">
            🔒 Military-grade encryption · Blockchain-secured · Decentralized
          </p>
        </div>
      </div>
    </div>
  );
}
