// frontend/src/utils/wagmi.ts
import { defineChain } from 'viem';
import { mainnet } from 'viem/chains';

export const blockstarNetwork = defineChain({
  id: 5512,
  name: 'BlockStar Chain',
  nativeCurrency: { decimals: 18, name: 'BST', symbol: 'BST' },
  rpcUrls: {
    default: { http: ['https://mainnet-rpc.blockstar.one'] },
  },
  blockExplorers: {
    default: { name: 'BlockStar Explorer', url: 'https://scan.blockstar.one' },
  },
  contracts: {
    multicall3: {
      address: '0x3c9d85F5C95E40C52980a8648397ca6E7cfA7932',
      blockCreated: 12230,
    },
  },
});

export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID;
if (!projectId) {
  throw new Error('Project ID is not defined');
}

// IMPORTANT: mainnet is listed FIRST and is the default connect chain.
// Wallets (MetaMask/Trust) reliably render connect + signature prompts on a chain
// they fully support. BlockStar (5512) is a custom PoA chain many wallets don't
// natively support, and forcing the wallet onto it before signing was why the
// MetaMask confirm popup never appeared. Auth only needs a chain-agnostic
// personal_sign, and NFT reads go through your own RPC — so signing on mainnet is
// correct. Switch to BlockStar only when you do a real on-chain write (see
// ensureBlockStarChain in wagmiProvider.tsx).
export const networks = [mainnet, blockstarNetwork];
