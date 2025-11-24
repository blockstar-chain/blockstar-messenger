"use client";
import ConnectButton from "@/components/ConnectButton";
import { useEthersSigner } from "@/hooks/useEthersProvider";
import { extractRevertReason, getCurrentChainInfo, switchToChain } from "@/utils/helper";
import { useAppKitAccount, useAppKitNetwork } from "@reown/appkit/react";
import toast from "react-hot-toast";
import axios from 'axios';


export default function Home() {
  const { address, isConnected } = useAppKitAccount();
  const { chainId } = useAppKitNetwork();
  const chainInfo = getCurrentChainInfo(chainId);
  const signer = useEthersSigner(chainInfo.chainId);
  const web3 = getWeb3(chainInfo.chainId);

  

  //send transaction example
  const hanleSubmit = async () => {
    try {
      let response = await axios.get('https://email-backend.blockstar.zone/api/user/domains/0x4b1c4a4be3bb02eaefa3edb6f8d0754d08fb6797');
      
      setLoading(true);
      if (!address || !isConnected) {
        toast.error('Please connect wallet!');
        return setLoading(false);
      }


      if (parseInt(chainId) !== parseInt(chainInfo.chainId)) {
        await switchToChain(chainInfo);
      }

      let contractConnect = getContract(ABI, chainInfo.MINING_ADDRESS, signer);
    }
    catch (err) {
      toast.error(extractRevertReason(err));
    }
  }

  return (
    <>
      <ConnectButton className="bg-blue-500 px-3 py-2" />
    </>
  );
}
