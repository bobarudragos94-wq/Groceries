/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.schwarz' },
      { protocol: 'https', hostname: 'media.kaufland.com' },
      { protocol: 'https', hostname: '**.lidl.ro' }
    ]
  }
};

export default nextConfig;
