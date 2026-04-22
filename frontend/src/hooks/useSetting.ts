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
                // V3: Parse name and TLD (e.g., "name@tld" or "name.tld" or just "name")
                let domainName = name.trim();
                let tld = 'blockstar'; // default TLD

                if (domainName.includes('@')) {
                    const parts = domainName.split('@');
                    domainName = parts[0];
                    tld = parts[1] || 'blockstar';
                } else if (domainName.includes('.')) {
                    const parts = domainName.split('.');
                    domainName = parts[0];
                    tld = parts[1] || 'blockstar';
                }

                let contract = getWeb3Contract(NFT_ABI, process.env.NEXT_PUBLIC_NFT_CONTRACT || "" as string);
                
                // V3: Use getAllRecords(name, tld) instead of getUnifiedRecords
                let records = await contract.methods.getAllRecords(domainName, tld).call();

                let data: any = [];

                // V3: Use getDomainInfo(name, tld) to get owner and tokenId in one call
                let domainInfo = await contract.methods.getDomainInfo(domainName, tld).call();
                let owner = domainInfo.domainOwner || domainInfo[0] || '';
                let tokenId = domainInfo.tokenId || domainInfo[3] || 0;

                // V3: Fetch metadata (description, image) if tokenId exists
                let metaImage = '';
                let metaDescription = '';
                if (tokenId && Number(tokenId) > 0) {
                    try {
                        let metadata = await contract.methods.getMetadata(tokenId).call();
                        metaDescription = metadata.description || metadata[0] || '';
                        metaImage = metadata.image || metadata[1] || '';
                    } catch (err) {
                        console.log('Could not get metadata:', err);
                    }
                }

                let banner: any = '';
                let profile: any = '';
                let bio: any = '';

                if (records) {
                    let index = 0;
                    const keys = records.keys || records[0];
                    const values = records.values || records[1];
                    
                    keys.map((item: any, key: any) => {
                        const itemLower = item.toLowerCase();
                        if ((itemLower === 'avatar' || itemLower === 'profile' || itemLower === 'pfp') && filter) {
                            profile = ipfsToUrl(values[key]) || values[key]
                        }
                        else if ((itemLower === 'banner' || itemLower === 'cover') && filter) {
                            banner = ipfsToUrl(values[key]) || values[key]
                        }
                        else if ((itemLower === 'bio' || itemLower === 'description' || itemLower === 'about') && filter) {
                            bio = values[key]
                        }
                        else if (itemLower === 'display_name' && filter) {
                            // display_name is metadata, not a social link — skip it
                        }
                        else {
                            data[index] = {
                                key: item,
                                value: values[key]
                            }
                            index++;
                        }
                    })
                }

                // V3: Use metadata as fallback for profile image and bio
                if (!profile && metaImage) {
                    profile = ipfsToUrl(metaImage) || metaImage;
                }
                if (!bio && metaDescription) {
                    bio = metaDescription;
                }

                setStats({
                    loading: false,
                    error: false,
                    data,
                    owner,
                    profile,
                    banner,
                    bio,
                    subdomains: [],      // V3: No subdomain support
                    isSubdomain: false,  // V3: No subdomain support
                    main_domain: domainName,
                    sub_domain: ''
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