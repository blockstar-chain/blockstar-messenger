"use client";
// frontend/src/utils/wagmiProvider.tsx
// Manual wagmi config so we can set the WalletConnect connector's metadata.redirect.
// Without redirect.native, MetaMask on iOS doesn't return to the app after signing,
// so the relay response is missed intermittently. redirect makes it bounce back,
// foregrounding the app so the signature is delivered reliably.

import { WagmiProvider, createConfig, http } from "wagmi";
import { switchChain } from "@wagmi/core";
import { walletConnect, injected, coinbaseWallet } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider } from "connectkit";
import { networks, projectId, blockstarNetwork } from "./wagmi";
import { mainnet } from "viem/chains";

const APP_NAME = process.env.NEXT_PUBLIC_PROJECT_NAME || "BlockStar Cypher";
const APP_URL = process.env.NEXT_PUBLIC_PROJECT_URL || "https://messenger.blockstar.world";
const APP_ICON = "https://messenger.blockstar.world/icon.png";

export const config = createConfig({
  chains: [mainnet, blockstarNetwork],
  ssr: true,
  transports: {
    [mainnet.id]: http(),
    [blockstarNetwork.id]: http(blockstarNetwork.rpcUrls.default.http[0]),
  },
  connectors: [
    injected({ shimDisconnect: true }),
    walletConnect({
      projectId: projectId || "",
      showQrModal: false, // ConnectKit renders its own modal
      metadata: {
        name: APP_NAME,
        description: process.env.NEXT_PUBLIC_PROJECT_DESC || "Secure Web3 messaging",
        url: APP_URL,
        icons: [APP_ICON],
        // THE FIX: make the wallet return to the app after connect/sign on mobile.
        redirect: {
          native: "blockstarcypher://",           // matches CFBundleURLSchemes in Info.plist
          universal: APP_URL,                       // optional; best if you set up Universal Links
        },
      },
    }),
    coinbaseWallet({ appName: APP_NAME }),
  ],
});

/**
 * Switch/add BlockStar Chain. Call ONLY right before an on-chain write that must
 * run on BlockStar — never on connect (that breaks the signature prompt on iOS).
 */
export async function ensureBlockStarChain(): Promise<void> {
  try {
    await switchChain(config, {
      chainId: blockstarNetwork.id,
      addEthereumChainParameter: {
        chainName: blockstarNetwork.name,
        nativeCurrency: blockstarNetwork.nativeCurrency,
        rpcUrls: [blockstarNetwork.rpcUrls.default.http[0]],
        blockExplorerUrls: [blockstarNetwork.blockExplorers!.default.url],
      },
    });
  } catch (e) {
    console.warn("ensureBlockStarChain: could not switch/add chain", e);
  }
}

const queryClient = new QueryClient();

export const Web3Provider = ({ children }: { children: React.ReactNode }) => {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          theme="midnight"
          options={{
            initialChainId: mainnet.id, // connect + sign on a chain wallets fully support
            enforceSupportedChains: false,
          }}
        >
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
