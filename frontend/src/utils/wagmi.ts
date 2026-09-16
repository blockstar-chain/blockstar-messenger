import { cookieStorage, createStorage, http } from '@wagmi/core'


export const blockstarNetwork = {
    "id": 5512,
    "name": "BlockStar Chain",
    "nativeCurrency": {
        decimals: 18,
        name: 'BST',
        symbol: 'BST',
    },
    "blockTime": 12000,
    "rpcUrls": {
        "default": {
            "http": [
                "https://mainnet-rpc.blockstar.one"
            ]
        }
    },
    "blockExplorers": {
        "default": {
            "name": "BlockStarscan",
            "url": "https://scan.blockstar.one",
            "apiUrl": "https://scan.blockstar.one/api"
        }
    },
    "contracts": {
        "multicall3": {
            "address": "0x3c9d85F5C95E40C52980a8648397ca6E7cfA7932",
            "blockCreated": 12230
        }
    }
}



// Get projectId from https://dashboard.reown.com
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID

if (!projectId) {
  throw new Error('Project ID is not defined')
}

export const networks : any = [blockstarNetwork]