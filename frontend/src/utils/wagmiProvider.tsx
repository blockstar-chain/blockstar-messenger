'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAppKit } from '@reown/appkit/react'

import React, { type ReactNode } from 'react'
import { WagmiProvider, Config } from 'wagmi'
import { projectId, wagmiAdapter, blockstarNetwork } from './wagmi'

// Set up queryClient
const queryClient = new QueryClient()

if (!projectId) {
  throw new Error('Project ID is not defined')
}

const metadata = {
  name: process.env.NEXT_PUBLIC_PROJECT_NAME || "",
  description: process.env.NEXT_PUBLIC_PROJECT_DESC || "",
  url: process.env.NEXT_PUBLIC_PROJECT_URL || "",
  icons: ['https://avatars.githubusercontent.com/u/179229932']
}

// Create the modal
const modal = createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [blockstarNetwork],
  metadata: metadata,
  features: {
    analytics: true, // Optional - defaults to your Cloud configuration
    socials: [],
    email: false,
    onramp: false,
    swaps: false,
    send: false
  },
})

function WalletProvider({ children, initialState }: { children: ReactNode; initialState: any }) {

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig as Config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}

export default WalletProvider