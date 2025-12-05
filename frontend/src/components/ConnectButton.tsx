import { trimAddress } from "@/utils/helpers";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { Wallet } from "lucide-react";




export default function ConnectButton({ className, isConnecting }: { className: any, isConnecting }) {
    const { open } = useAppKit();
    const { address, isConnected } = useAppKitAccount();



    return (
        address && isConnected ? (

            <button onClick={() => open()} type="button" className={className} >
                {isConnecting ? (
                    <>
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                        Connecting...
                    </>
                ) : (
                    <>
                        {trimAddress(address)}

                    </>
                )}

            </button>
        ) : (
            <button onClick={() => open()} type="button" className={className} >
                <Wallet size={22} />
                Connect Wallet
            </button >
        )

    )
}