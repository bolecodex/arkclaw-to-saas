/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 因为本地 link，需要让 next 走 transpile
  transpilePackages: ['@arkclaw/widget'],
};

export default nextConfig;
