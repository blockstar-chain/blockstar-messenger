import { ethers, BrowserProvider, JsonRpcSigner } from 'ethers';
import { NFTMetadata } from '@/types';
import NFT_ABI from '@/abi/nft.json';
import axios from 'axios';

// BlockStar Chain Configuration from environment
const BLOCKSTAR_CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID || '0x89'; // Default to Polygon
const BLOCKSTAR_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://polygon-rpc.com';
const NFT_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_NFT_CONTRACT || '0x0000000000000000000000000000000000000000';
const CHAIN_NAME = process.env.NEXT_PUBLIC_CHAIN_NAME || 'Polygon';
const CHAIN_SYMBOL = process.env.NEXT_PUBLIC_CHAIN_SYMBOL || 'MATIC';
const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://polygonscan.com';


export class BlockchainService {
  private provider: BrowserProvider | null = null;
  private signer: JsonRpcSigner | null = null;
  private nftContract: ethers.Contract | null = null;

  async connectWallet(): Promise<string> {
    if (typeof window.ethereum === 'undefined') {
      throw new Error('Please install MetaMask or another Web3 wallet');
    }

    try {
      this.provider = new BrowserProvider(window.ethereum);

      // Request account access
      await window.ethereum.request({ method: 'eth_requestAccounts' });

      // Check if on BlockStar Chain
      const network = await this.provider.getNetwork();
      if (network.chainId.toString() !== BLOCKSTAR_CHAIN_ID) {
        await this.switchToBlockStarChain();
      }

      this.signer = await this.provider.getSigner();
      const address = await this.signer.getAddress();

      // Initialize NFT contract
      this.nftContract = new ethers.Contract(
        NFT_CONTRACT_ADDRESS,
        NFT_ABI,
        this.signer
      );

      return address;
    } catch (error) {
      console.error('Wallet connection error:', error);
      throw error;
    }
  }

  async switchToBlockStarChain(): Promise<void> {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BLOCKSTAR_CHAIN_ID }],
      });
    } catch (switchError: any) {
      // Chain not added to MetaMask
      if (switchError.code === 4902) {
        await this.addBlockStarChain();
      } else {
        throw switchError;
      }
    }
  }

  async addBlockStarChain(): Promise<void> {
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: BLOCKSTAR_CHAIN_ID,
          chainName: CHAIN_NAME,
          nativeCurrency: {
            name: CHAIN_NAME,
            symbol: CHAIN_SYMBOL,
            decimals: 18,
          },
          rpcUrls: [BLOCKSTAR_RPC_URL],
          blockExplorerUrls: [EXPLORER_URL],
        },
      ],
    });
  }

  async verifyNFTOwnership(address: string): Promise<NFTMetadata | null> {
    if (!this.nftContract) {
      throw new Error('NFT contract not initialized');
    }

    try {
      const balance = await this.nftContract.balanceOf(address);
      
      if (Number(balance.toString()) === 0) {
        return null; // No NFT owned
      }

      let response = await axios.post(`https://nftapp.blockstar.kids/api/nft/collected`, {
        address,
        nftaddress: NFT_CONTRACT_ADDRESS
      });


      if (!response || !response.data || !response.data.data || response.data.data.length === 0) {
        return null;
      }

      const tokenId = response.data.data[0]?.tokenId;

      // Get token URI and metadata
      const name = await this.nftContract.getPrimaryName(address);


      return {
        name: name || `@user${tokenId.toString()}`,
        tokenId: tokenId.toString(),
        owner: address,
        contractAddress: NFT_CONTRACT_ADDRESS,
      };
    } catch (error) {
      console.error('NFT verification error:', error);
      return null;
    }
  }

  async signMessage(message: string): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not initialized');
    }

    return await this.signer.signMessage(message);
  }

  async getCurrentAddress(): Promise<string | null> {
    if (!this.signer) return null;
    return await this.signer.getAddress();
  }

  disconnect(): void {
    this.provider = null;
    this.signer = null;
    this.nftContract = null;
  }

  // Listen for account changes
  onAccountsChanged(callback: (accounts: string[]) => void): void {
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', callback);
    }
  }

  // Listen for chain changes
  onChainChanged(callback: (chainId: string) => void): void {
    if (window.ethereum) {
      window.ethereum.on('chainChanged', callback);
    }
  }
}

export const blockchainService = new BlockchainService();

// Extend window type for ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}
