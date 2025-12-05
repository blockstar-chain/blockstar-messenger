import { trimAddress } from "@/utils/helpers";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";




export default function ConnectButton({ className }: { className: any }) {
    const { open } = useAppKit();
    const { address, isConnected } = useAppKitAccount();



    return (
        address && isConnected ? (
            <button onClick={() => open()} type="button" className={className} >
                {trimAddress(address)}
            </button>
        ) : (
            <button onClick={() => open()} type="button" className={className} >
                Connect Wallet
            </button >
        )

    )
}