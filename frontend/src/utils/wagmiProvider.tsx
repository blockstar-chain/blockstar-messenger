"use client";
// frontend/src/utils/wagmiProvider.tsx
// FIX: on mobile (WalletConnect) there is no window.ethereum, so the old
// switchToBlockStarChain()/addBlockStarChain() in blockchain.ts never ran and
// wallets stayed on the wrong network. We now switch/add the chain through wagmi,
// which works for BOTH injected (desktop) and WalletConnect (mobile) connectors,
// and we trigger it automatically right after a wallet connects.

import { WagmiProvider, createConfig } from "wagmi";
import { switchChain } from "@wagmi/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider, getDefaultConfig } from "connectkit";
import { networks, projectId, blockstarNetwork } from "./wagmi";
import { mainnet } from "viem/chains";

const metadata = {
  name: process.env.NEXT_PUBLIC_PROJECT_NAME || "BlockStar Cypher",
  description: process.env.NEXT_PUBLIC_PROJECT_DESC || "",
  url: process.env.NEXT_PUBLIC_PROJECT_URL || "",
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
};

export const config = createConfig(
  getDefaultConfig({
    chains: networks || [mainnet],
    walletConnectProjectId: projectId || "",
    appName: metadata.name,
    enableAaveAccount: false,
    appDescription: metadata.description,
    appUrl: metadata.url,
    appIcon: metadata.icons[0] || "https://family.co/logo.png",
  })
);

/**
 * Ensure the connected wallet is on BlockStar Chain, adding it if the wallet
 * doesn't know it. Works over injected AND WalletConnect connectors.
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
    // User may reject the add/switch; log but don't crash the connect flow.
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
          // As soon as a wallet connects (desktop or mobile), make sure it's on
          // BlockStar Chain — this replaces the window.ethereum-only path.
          onConnect={() => {
            void ensureBlockStarChain();
          }}
          options={{
            initialChainId: blockstarNetwork.id,
            // Only our chain is supported; don't nag with a "wrong network" wall
            // before we've had a chance to switch.
            enforceSupportedChains: false,
          }}
        >
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
