"use client";

import { useEffect, useState } from "react";
import Web3 from "web3";
import MULTICALL_ABI from "../abi/multicall.json";
import NFT_ABI from "../abi/nft.json";

export const MULTICALL_ADDRESS = "0x3c9d85F5C95E40C52980a8648397ca6E7cfA7932";
export const getWeb3 = () => {
    return new Web3(process.env.NEXT_PUBLIC_RPC_URL || "");
}

export const getWeb3Contract = (abi: any, address: string) => {
    let web3 = getWeb3();
    return new web3.eth.Contract(abi, address);
}

export const getMultiCall = async (calls: any) => {

    let web3 = getWeb3();
    const mc = new web3.eth.Contract(MULTICALL_ABI as any, MULTICALL_ADDRESS);
    const callRequests = calls.map((call: any) => {
        const callData = call.encodeABI();
        return {
            target: call._parent._address,
            callData,
        };
    });

    const { returnData } = await mc.methods
        .aggregate(callRequests)
        .call({});

    let finalData = returnData.map((hex: any, index: any) => {
        const types = calls[index]._method.outputs.map((o: any) =>
            o.internalType !== o.type && o.internalType !== undefined ? o : o.type
        );

        let result = web3.eth.abi.decodeParameters(types, hex);

        delete result.__length__;

        result = Object.values(result);

        return result.length === 1 ? result[0] : result;
    });

    return finalData;
}

export function ipfsToUrl(input: any) {
    if (!input || typeof input !== 'string') return null;

    let hash = input.trim();

    // Match IPFS hash (typically starts with Qm or bafy and is 46+ chars)
    const ipfsHashRegex = /(?:ipfs:\/\/|\/ipfs\/)?([a-zA-Z0-9]{46,})/;

    const match = hash.match(ipfsHashRegex);
    if (match && match[1]) {
        return 'https://alchemy.mypinata.cloud/ipfs/' + match[1];
    }

    return null; // Not a valid IPFS input
}


export const useSettingReslover = (name = '', filter = true) => {
    const [stats, setStats] = useState({
        loading: true,
        data: [],
        owner: '',
        profile: '',
        banner: '',
        bio: '',
        error: false,
        subdomains: [],
        isSubdomain: false,
        main_domain: '',
        sub_domain: ''
    });

    useEffect(() => {
        async function fetch() {
            try {
                let split_name = name.trim().split('.');

                let contract = getWeb3Contract(NFT_ABI, process.env.NEXT_PUBLIC_NFT_CONTRACT || "" as string);
                let records = null;
                let domain_name = '';
                let sub_domain = '';
                let isSubdomain = false;
                if (split_name.length === 1) {
                    domain_name = split_name[0]
                    records = await contract.methods.getUnifiedRecords(split_name[0], "").call();
                }
                else if (split_name.length > 1) {
                    domain_name = split_name[1];
                    isSubdomain = true;
                    sub_domain = split_name[0];
                    records = await contract.methods.getUnifiedRecords(split_name[1], split_name[0] ? split_name[0] : '').call();
                }

                let data: any = [];

                let tokenIdOfName = await contract.methods.getNameToTokenId(domain_name).call();
                let owner = '';
                if (tokenIdOfName) {
                    owner = await contract.methods.ownerOf(tokenIdOfName).call();
                }

                let subdomains = await contract.methods.getAllSubdomains(domain_name).call();

                let banner: any = '';
                let profile: any = '';
                let bio: any = '';

                if (records) {
                    let index = 0;
                    records[0].map((items: any, key: any) => {
                        if (items === 'profile' && filter) {
                            profile = ipfsToUrl(records[1][key])
                        }
                        else if (items === 'banner' && filter) {
                            banner = ipfsToUrl(records[1][key])
                        }
                        else if (items === 'bio' && filter) {
                            bio = records[1][key]
                        }
                        else {
                            data[index] = {
                                key: items,
                                value: records[1][key]
                            }
                            index++;
                        }
                    })

                }

                console.log(banner)

                setStats({
                    loading: false,
                    error: false,
                    data,
                    owner,
                    profile,
                    banner,
                    bio,
                    subdomains,
                    isSubdomain,
                    main_domain: domain_name,
                    sub_domain
                })
            }
            catch (err) {
                console.log(err);
                setStats({
                    loading: false,
                    error: true,
                    data: [],
                    owner: '',
                    profile: '',
                    banner: '',
                    bio: '',
                    subdomains: [],
                    isSubdomain: false,
                    main_domain: '',
                    sub_domain: ''
                })
            }

        }
        if (name) {
            fetch();
        }
        else {
            setStats({
                loading: false,
                error: false,
                data: [],
                owner: '',
                profile: '',
                banner: '',
                bio: '',
                subdomains: [],
                isSubdomain: false,
                main_domain: '',
                sub_domain: ''
            })
        }
    }, [name])

    return stats;
}