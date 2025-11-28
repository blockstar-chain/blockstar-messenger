import type { Metadata } from 'next';
import './globals.css';

// Using system font stack instead of Google Fonts
const fontClass = 'font-sans';

export const metadata: Metadata = {
  title: 'BlockStar Cypher',
  description: 'Secure, decentralized messaging on BlockStar Chain',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${fontClass} bg-midnight text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
