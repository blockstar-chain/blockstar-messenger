export const blockstar_test = {
    id: 55,
    name: 'BlockStar TEST',
    network: 'blockstar-test',
    nativeCurrency: {
        decimals: 18,
        name: 'BlockStar',
        symbol: 'TBST',
    },
    rpcUrls: {
        public: { http: ['https://testnet-rpc.blockstar.one'] },
        default: { http: ['https://testnet-rpc.blockstar.one'] },
    },
    blockExplorers: {
        etherscan: { name: 'BlockStarScan', url: 'https://testnet-scan.blockstar.one' },
        default: { name: 'BlockStarScan', url: 'https://testnet-scan.blockstar.one' },
    },
    contracts: {
        multicall3: {
            address: '0x7f48EFC990Ed74c46b7124A29De5dd4ad2AC4221',
            blockCreated: 12230,
        },
    },
}

export const blockstar = {
    id: 5512,
    name: 'BlockStar',
    network: 'blockstar',
    nativeCurrency: {
        decimals: 18,
        name: 'BlockStar',
        symbol: 'BST',
    },
    rpcUrls: {
        public: { http: ['https://mainnet-rpc.blockstar.one'] },
        default: { http: ['https://mainnet-rpc.blockstar.one'] },
    },
    blockExplorers: {
        etherscan: { name: 'BlockStarScan', url: 'https://scan.blockstar.one' },
        default: { name: 'BlockStarScan', url: 'https://scan.blockstar.one' },
    },
    contracts: {
        multicall3: {
            address: '0x3c9d85F5C95E40C52980a8648397ca6E7cfA7932',
            blockCreated: 12230,
        },
    }
}

export const ALL_NETWORKS = {
    5512: {
        name: "BlockStar",
        symbol: "BST",
        rpc: "https://mainnet-rpc.blockstar.one",
        chainId: 5512,
        explorer: "https://scan.blockstar.one/",
        BLOCKSTAR_DOMAINS_ADDRESS : "0x1E9248a78352150e8b2E7E728346EDd41A77FDeA"
    },
    55: {
        name: "BlockStar Testnet",
        symbol: "TBST",
        rpc: "https://testnet-rpc.blockstar.one",
        chainId: 55,
        explorer: "https://testnet-scan.blockstar.one/",
        BLOCKSTAR_DOMAINS_ADDRESS : "0x78fbe4845A9f00652C9C98Cc012aAD95D267DA2e"
    }
};

export const DEFAULT_CHAIN_ID = 5512;
export const chains = [blockstar , blockstar_test]
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID;
export const projectName = process.env.NEXT_PUBLIC_PROJECT_NAME;
export const projectDesc = process.env.NEXT_PUBLIC_PROJECT_DESC;
export const projectUrl = process.env.NEXT_PUBLIC_PROJECT_URL;
export const projectIcon = process.env.NEXT_PUBLIC_PROJECT_ICON;
export const modalColorCode = process.env.NEXT_PUBLIC_CONNECT_MODAL_COLOR_CODE;
