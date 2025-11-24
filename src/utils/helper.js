
import moment from 'moment'
import { ALL_NETWORKS, DEFAULT_CHAIN_ID} from './constant';

export const trimAddress = (addr) => {
    try {
        if (!addr) return '';
        return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
    }
    catch (err) {
        return addr;
    }
}

export function formatPrice(
    value,
    decimals = 4
) {
    if (isNaN(value)) return '0';

    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: decimals,
    }).format(value);
}

export const formatDate = (timestamp, format = '') => {
    try {
        if (format) {
            return moment(timestamp * 1000).format(format);
        } else {
            return moment(timestamp * 1000).format('DD-MM-YYYY');
        }
    } catch (err) {
        console.error(err.message);
        return false;
    }
};

export const getCurrentChainInfo = (chainId = DEFAULT_CHAIN_ID) => {
    return ALL_NETWORKS[chainId] || ALL_NETWORKS[DEFAULT_CHAIN_ID];
};

export const extractRevertReason = (error) => {
    const raw = error?.reason || error?.message || "Transaction failed";

    // Remove the 0x-prefixed ABI-encoded part if it exists
    const cleaned = raw.split("0x")[0]?.trim();

    return cleaned.endsWith(":") ? cleaned.slice(0, -1).trim() : cleaned;
}

export const switchToChain = async (chainData) => {
    try {
        // Request MetaMask to switch to the specified chain
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${parseInt(chainData.chainId, 10).toString(16)}` }] // Convert chainId to hexadecimal
        });
        console.log(`Switched to chain with ID: ${chainData.chainId}`);
        return true;
    } catch (error) {
        if (error.code === 4902) {
            // This error code indicates the chain is not available in MetaMask
            if (chainData) {
                try {
                    // Add the chain to MetaMask
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [
                            {
                                chainId: `0x${parseInt(chainData.chainId, 10).toString(16)}`,
                                chainName: chainData.name,
                                nativeCurrency: {
                                    name: chainData.name,
                                    symbol: chainData.symbol,
                                    decimals: 18
                                },
                                rpcUrls: [chainData.rpc],
                                blockExplorerUrls: [chainData.explorer]
                            }
                        ]
                    });
                    return true;
                } catch (addError) {
                    console.error('Failed to add the chain:', addError);
                    return false;
                }
            } else {
                console.error('Chain is not available in MetaMask and no data provided to add it.');
                return false;
            }
        } else {
            console.error('Failed to switch chain:', error);
            return false;
        }
    }
}