/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  basePath: '',
  assetPrefix: process.env.NODE_ENV === 'production' ? './' : '',
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    return config;
  },
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Fix for Electron
      config.output.publicPath = './_next/';
    }
    return config;
  },
  trailingSlash: true,
  output: 'export',
}

module.exports = nextConfig
