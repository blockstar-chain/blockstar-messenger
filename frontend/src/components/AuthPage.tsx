import React, { useState } from 'react';
import { useAppStore } from '@/store';
import { blockchainService } from '@/lib/blockchain';
import { encryptionService } from '@/lib/encryption';
import { webSocketService } from '@/lib/websocket';
import { Wallet, Shield, Lock, CheckCircle, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import logoImg from '@/images/logo.png';
import Image from 'next/image';


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

      // Initialize encryption with wallet-derived keys
      const signMessageFn = async (message: string) => {
        return await blockchainService.signMessage(message);
      };

      await encryptionService.initialize(address, signMessageFn);
      const publicKey = await encryptionService.getPublicKey();

      toast.success('Encryption keys ready!');

      // Connect to messaging server with username
      webSocketService.connect(address, publicKey, nftMetadata.name);

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

  const StepIcon = ({ step, icon: Icon }: { step: string; icon: any }) => {
    const isActive = currentStep === step;
    const isComplete =
      (step === 'connect' && (currentStep === 'verify' || currentStep === 'encrypt')) ||
      (step === 'verify' && currentStep === 'encrypt');

    return (
      <div className={`p-3 rounded-xl transition-all duration-300 ${isActive
        ? 'bg-gradient-to-br from-primary-500 to-cyan-500 shadow-glow'
        : isComplete
          ? 'bg-success-500/20 border border-success-500/50'
          : 'bg-dark-200 border border-midnight'
        }`}>
        <Icon
          size={22}
          className={
            isActive
              ? 'text-white'
              : isComplete
                ? 'text-success-500'
                : 'text-secondary'
          }
        />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-midnight flex items-center justify-center p-4 relative overflow-auto">
      {/* Background Effects */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Gradient orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-500/20 rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl"></div>

        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: `linear-gradient(rgba(0, 102, 255, 0.3) 1px, transparent 1px),
                             linear-gradient(90deg, rgba(0, 102, 255, 0.3) 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        ></div>
      </div>

      <div className="max-w-md mt-[50px] w-full relative z-10">
        {/* Logo/Header */}
        <div className="text-center flex justify-center items-center mb-8">
          <Image
            src={logoImg}
            alt="BlockStar Logo"
            height={50}
          />
        </div>
        <p className="text-secondary text-lg text-center">Secure, Decentralized Communication</p>

        {/* Auth Card */}
        <div className="bg-card border border-midnight rounded-2xl p-8 shadow-2xl backdrop-blur-sm">
          <h2 className="text-2xl font-bold text-white mb-2 text-center">
            Connect Your Wallet
          </h2>
          <p className="text-secondary text-center mb-8">
            Sign in with your Web3 wallet to get started
          </p>

          {/* Steps */}
          <div className="space-y-4 mb-8">
            {/* Step 1: Connect */}
            <div className={`flex items-start gap-4 p-4 rounded-xl transition-all duration-300 ${currentStep === 'connect' ? 'bg-dark-200 border border-primary-500/30' : 'bg-transparent'
              }`}>
              <StepIcon step="connect" icon={Wallet} />
              <div className="flex-1">
                <h3 className="font-semibold text-white">Connect Wallet</h3>
                <p className="text-sm text-secondary">Connect your Web3 wallet to get started</p>
              </div>
              {isConnecting && currentStep === 'connect' && (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-500 border-t-transparent"></div>
              )}
            </div>

            {/* Step 2: Verify */}
            <div className={`flex items-start gap-4 p-4 rounded-xl transition-all duration-300 ${currentStep === 'verify' ? 'bg-dark-200 border border-primary-500/30' : 'bg-transparent'
              }`}>
              <StepIcon step="verify" icon={CheckCircle} />
              <div className="flex-1">
                <h3 className="font-semibold text-white">Verify @name NFT</h3>
                <p className="text-sm text-secondary">Verify ownership of your @name NFT</p>
              </div>
              {isConnecting && currentStep === 'verify' && (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-500 border-t-transparent"></div>
              )}
            </div>

            {/* Step 3: Encrypt */}
            <div className={`flex items-start gap-4 p-4 rounded-xl transition-all duration-300 ${currentStep === 'encrypt' ? 'bg-dark-200 border border-primary-500/30' : 'bg-transparent'
              }`}>
              <StepIcon step="encrypt" icon={Lock} />
              <div className="flex-1">
                <h3 className="font-semibold text-white">Initialize Encryption</h3>
                <p className="text-sm text-secondary">Set up end-to-end encryption</p>
              </div>
              {isConnecting && currentStep === 'encrypt' && (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-500 border-t-transparent"></div>
              )}
            </div>
          </div>

          {/* Connect Button */}
          <button
            onClick={handleConnectWallet}
            disabled={isConnecting}
            className="w-full bg-gradient-to-r from-primary-500 to-cyan-500 hover:from-primary-600 hover:to-cyan-600 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-glow hover:shadow-glow-lg"
          >
            {isConnecting ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                Connecting...
              </>
            ) : (
              <>
                <Wallet size={22} />
                Connect Wallet
              </>
            )}
          </button>

          {/* Info */}
          <div className="mt-6 p-4 bg-dark-200 border border-midnight rounded-xl">
            <p className="text-sm text-secondary text-center">
              You need an <span className="text-primary-500 font-semibold">@name NFT</span> to use BlockStar Cypher.{' '}
              <a
                href="https://domains.blockstar.site/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-500 hover:text-cyan-400 font-semibold transition-colors"
              >
                Get yours now →
              </a>
            </p>
          </div>
        </div>

        {/* Security Info */}
        <div className="mt-8 text-center">
          <div className="flex items-center justify-center gap-6 text-secondary text-sm">
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-primary-500" />
              <span>Military-grade encryption</span>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-cyan-500" />
              <span>Blockchain-secured</span>
            </div>
          </div>
        </div>

        {/* Version */}
        <div className="mt-6 text-center">
          <p className="text-muted text-xs">BlockStar Cypher v1.0.0 · BlockStar Mainnet</p>
        </div>
      </div>
    </div>
  );
}
