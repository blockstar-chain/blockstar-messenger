import { ethers, JsonRpcSigner } from 'ethers';
import { NFTMetadata } from '@/types';
import NFT_ABI from '@/abi/nft.json';
import axios from 'axios';

// BlockStar Chain Configuration from environment
const BLOCKSTAR_CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID || '0x1588'; // Default to Polygon
const BLOCKSTAR_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://mainnet-rpc.blockstar.one';
const NFT_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_NFT_CONTRACT || '0x1E9248a78352150e8b2E7E728346EDd41A77FDeA';
const CHAIN_NAME = process.env.NEXT_PUBLIC_CHAIN_NAME || 'BlockStar';
const CHAIN_SYMBOL = process.env.NEXT_PUBLIC_CHAIN_SYMBOL || 'BST';
const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://scan.blockstar.one';


export class BlockchainService {
  private provider: any | null = null;
  private signer: JsonRpcSigner | null = null;
  private nftContract: ethers.Contract | null = null;

  async connectWallet(): Promise<Boolean> {
   
    try {
      this.provider = new ethers.JsonRpcProvider(BLOCKSTAR_RPC_URL);

      // Initialize NFT contract
      this.nftContract = new ethers.Contract(
        NFT_CONTRACT_ADDRESS,
        NFT_ABI,
        this.provider
      );

      return true;
    } catch (error) {
      console.error('Wallet connection error:', error);
      throw error;
      return false;
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

  async verifyNFTOwnership(address: any): Promise<NFTMetadata | null> {
    if (!this.nftContract) {
      throw new Error('NFT contract not initialized');
    }

    try {
      const balance = await this.nftContract.balanceOf(address);
      
      if (Number(balance.toString()) === 0) {
        return null; // No NFT owned
      }

      let response = await axios.get(`https://email-backend.blockstar.site/api/user/domains/primary/${address}`);


      if (!response || !response.data || !response.data.success || !response.data.data) {
        return null;
      }

      const tokenId = response.data.data?.tokenId;

      // Get token URI and metadata
      const name = await this.nftContract.getPrimaryName(address);


      return {
        name: name[0]+"@"+name[1] || `@user${tokenId.toString()}`,
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
