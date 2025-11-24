"use client"

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAppKit } from '@reown/appkit/react'
import { WagmiProvider } from 'wagmi'
import { config, wagmiAdapter } from './wagmi'
import { chains, projectId, projectName, projectDesc, projectUrl, projectIcon } from './constant'
import React from 'react'


if (!projectId) {
    throw new Error('Project ID is not defined')
}


// Set up queryClient
const queryClient = new QueryClient()

// Set up metadata
const metadata = {
    name: projectName || 'Reown',
    description: projectDesc || 'Reown',
    url: projectUrl || 'https://reown.com', // origin must match your domain & subdomain
    icons: [projectIcon || 'https://reown.com/favicon.ico'],
}

// Create the modal
export const modal = createAppKit({
    adapters: [wagmiAdapter],
    projectId: projectId,
    networks: chains,
    metadata,
    features: {
        analytics: true, // Optional - defaults to your Cloud configuration
        socials: [],
        email: false,
        onramp: false,
        swaps: false,
        send: false
    },
    themeVariables: {
        '--w3m-accent': '#000000',
    }
})

export const WalletProvider = ({
    children,
    initialState,
}) => {
    const [queryClient] = React.useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        refetchOnWindowFocus: false, // configure as per your needs
                    },
                },
            })
    );

    return (
        <WagmiProvider config={config} initialState={initialState}>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </WagmiProvider>
    );
};

export default WalletProvider