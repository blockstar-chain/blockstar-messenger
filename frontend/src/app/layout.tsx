import type { Metadata, Viewport } from 'next';
import './globals.css';
import WalletProvider from '../utils/wagmiProvider';
import { cookieToInitialState } from 'wagmi';
import { config } from '@/utils/wagmi';
import { Toaster } from 'react-hot-toast';

// Using system font stack instead of Google Fonts
const fontClass = 'font-sans';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#6366f1',
};

export const metadata: Metadata = {
  title: 'BlockStar Cypher',
  description: 'Secure, decentralized messaging on BlockStar Chain',
  applicationName: 'BlockStar Cypher',
  keywords: ['blockchain', 'messenger', 'web3', 'crypto', 'decentralized', 'encrypted', 'secure'],
  authors: [{ name: 'BlockStar' }],
  creator: 'BlockStar',
  publisher: 'BlockStar',

  // PWA Manifest
  manifest: '/manifest.json',

  // Icons
  icons: {
    icon: [
      { url: '/favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    shortcut: '/favicon/favicon.ico',
  },

  // Apple iOS specific
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'BlockStar',
    startupImage: [
      {
        url: '/icons/icon-512.png',
        media: '(device-width: 390px) and (device-height: 844px)',
      },
    ],
  },

  // Open Graph for sharing
  openGraph: {
    type: 'website',
    siteName: 'BlockStar Cypher',
    title: 'BlockStar Cypher',
    description: 'Secure, decentralized Web3 messaging',
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512 }],
  },

  // Twitter Card
  twitter: {
    card: 'summary',
    title: 'BlockStar Cypher',
    description: 'Secure, decentralized Web3 messaging',
    images: ['/icons/icon-512.png'],
  },

  // Formatting detection
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },

  // Other
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'msapplication-TileColor': '#6366f1',
    'msapplication-tap-highlight': 'no',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialState = cookieToInitialState(config, undefined);
  return (
    <html lang="en" className="dark">
      <head>
        {/* Additional iOS Safari fixes */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="BlockStar" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />

        {/* Splash screens for iOS */}
        <link
          rel="apple-touch-startup-image"
          href="/icons/icon-512.png"
          media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)"
        />

        {/* Prevent zoom on input focus (iOS) */}
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body className={`${fontClass} bg-midnight text-white antialiased`}>
        <WalletProvider initialState={initialState}>
          <Toaster position='top-right' />
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
