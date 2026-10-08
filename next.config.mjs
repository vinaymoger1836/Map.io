/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Browser tests use their own build artifacts and a server-side read-only store.
  ...(process.env.MAPIO_E2E === '1' ? { distDir: '.next-e2e' } : {}),
};

export default nextConfig;
