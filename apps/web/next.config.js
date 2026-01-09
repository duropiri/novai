/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@novai/shared'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
};

module.exports = nextConfig;
