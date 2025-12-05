import { cookieStorage, createStorage, http } from '@wagmi/core'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { defineChain } from '@reown/appkit/networks'

export const blockstarNetwork = defineChain({
  id: 5512,
  caipNetworkId: 'eip155:5512',
  chainNamespace: 'eip155',
  name: 'BlockStar',
  nativeCurrency: {
    decimals: 18,
    name: 'BlockStar',
    symbol: 'BST',
  },
  rpcUrls: {
    default: {
      http: ['https://mainnet-rpc.blockstar.one'],
    },
    public: {
      http: ['https://mainnet-rpc.blockstar.one'],
    },
  },
  blockExplorers: {
    default: {
      name: 'BlockStarScan',
      url: 'https://scan.blockstar.one',
    },
  },
  contracts: {
    multicall3: {
      address: '0x3c9d85F5C95E40C52980a8648397ca6E7cfA7932',
      blockCreated: 12230,
    },
  },
});


// Get projectId from https://dashboard.reown.com
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID

if (!projectId) {
  throw new Error('Project ID is not defined')
}

export const networks = [blockstarNetwork]

//Set up the Wagmi Adapter (Config)
export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage
  }),
  ssr: true,
  projectId,
  networks
})

export const config = wagmiAdapter.wagmiConfig