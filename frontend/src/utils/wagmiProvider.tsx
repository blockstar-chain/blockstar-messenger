"use client" 
import { WagmiProvider, createConfig } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider, getDefaultConfig } from "connectkit";
import { networks, projectId } from "./wagmi";
import { mainnet } from "viem/chains";



const metadata = {
  name: process.env.NEXT_PUBLIC_PROJECT_NAME || "",
  description: process.env.NEXT_PUBLIC_PROJECT_DESC || "",
  url: process.env.NEXT_PUBLIC_PROJECT_URL || "",
  icons: ['https://avatars.githubusercontent.com/u/179229932']
}



const config = createConfig(
  getDefaultConfig({
    // Your dApps chains
    chains : networks || [mainnet],
    walletConnectProjectId: projectId || "",

    // Required App Info
    appName: metadata.name,
    enableAaveAccount : false,
    

    // Optional App Info
    appDescription: metadata.description,
    appUrl: metadata.url, // your app's url
    appIcon: [metadata.icons || "https://family.co/logo.png"] // your app's icon, no bigger than 1024x1024px (max. 1MB)
  }),
);

const queryClient = new QueryClient();

export const Web3Provider = ({ children }) => {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider theme="midnight">{children}</ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};