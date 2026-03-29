/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Optimize specific heavy packages for tree-shaking
  modularizeImports: {
    'date-fns': {
      transform: 'date-fns/{{member}}',
    },
    'lucide-react': {
      transform: 'lucide-react/dist/esm/icons/{{kebabCase member}}',
    },
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
  // Aggressive caching for static assets — JS/CSS chunks are content-hashed so safe to cache forever
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/(.*)\\.(png|jpg|jpeg|svg|ico|webp)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
    ];
  },
  // Reduce bundle size — exclude server-only code from client bundles
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns'],
  },
};

module.exports = nextConfig;
