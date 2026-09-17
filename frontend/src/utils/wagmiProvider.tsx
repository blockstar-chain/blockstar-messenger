"use client";
// frontend/src/utils/wagmiProvider.tsx
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
    chains: networks,
    walletConnectProjectId: projectId || "",
    appName: metadata.name,
    enableAaveAccount: false,
    appDescription: metadata.description,
    appUrl: metadata.url,
    appIcon: metadata.icons[0] || "https://family.co/logo.png",
  })
);

/**
 * Switch the wallet to BlockStar Chain, adding it if unknown. Works over injected
 * AND WalletConnect. CALL THIS ONLY right before an on-chain write that must run on
 * BlockStar — NOT on connect (switching to an unsupported custom chain right after
 * connect stops MetaMask from showing the signature prompt).
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
            // Connect + sign on mainnet (a chain wallets fully support) so the
            // signature confirmation popup actually appears on iOS.
            initialChainId: mainnet.id,
            enforceSupportedChains: false,
          }}
          // NOTE: no onConnect chain switch. Do NOT auto-switch to BlockStar here.
        >
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
