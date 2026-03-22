/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // SWC-based minification (faster builds, smaller output)
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
  // Compiler optimizations
  compiler: {
    // Remove console.log in production
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
};

module.exports = nextConfig;
