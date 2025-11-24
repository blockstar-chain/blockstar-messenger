import { ethers } from "ethers";
import Web3 from "web3";
import { ALL_NETWORKS, DEFAULT_CHAIN_ID } from "./constant";
import { MULTICALL_ABI , TOKEN_ABI } from "@/abi";



export const getWeb3 = (chainId = DEFAULT_CHAIN_ID) => {
    const network = ALL_NETWORKS[chainId];

    if (!network) {
        return false;
    }

    return new Web3(network.rpc);
};

export const getContract = (abi, address, library) => {
    try {
        return new ethers.Contract(address, abi, library)
    }
    catch {
        return false;
    }
}

export const getWeb3TokenContract = (address, chainId = DEFAULT_CHAIN_ID) => {
    let web3 = getWeb3(chainId);
    return new web3.eth.Contract(TOKEN_ABI, address);
}

export const getWeb3Contract = (ABI, address, chainId = DEFAULT_CHAIN_ID) => {
    let web3 = getWeb3(chainId);

    return new web3.eth.Contract(ABI, address);
}

export const getMultiCall = async (calls, chainId = DEFAULT_CHAIN_ID) => {

    let web3 = getWeb3(chainId);
    let network = ALL_NETWORKS[chainId];
    const mc = new web3.eth.Contract(MULTICALL_ABI, network.MULTICALL_ADDRESS);
    const callRequests = calls.map((call) => {
        const callData = call.encodeABI();
        return {
            target: call._parent._address,
            callData,
        };
    });

    const { returnData } = await mc.methods
        .aggregate(callRequests)
        .call({});

    let finalData = returnData.map((hex, index) => {
        const types = calls[index]._method.outputs.map((o) =>
            o.internalType !== o.type && o.internalType !== undefined ? o : o.type
        );

        let result = web3.eth.abi.decodeParameters(types, hex);

        delete result.__length__;

        result = Object.values(result);

        return result.length === 1 ? result[0] : result;
    });

    return finalData;
}