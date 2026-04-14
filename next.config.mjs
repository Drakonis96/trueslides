/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Allow mobile devices on the LAN to reach the dev server (presenter remote).
  // The '*' entry permits any origin during development only.
  allowedDevOrigins: ['*'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'upload.wikimedia.org',
      },
      {
        protocol: 'https',
        hostname: 'commons.wikimedia.org',
      },
    ],
  },
  serverExternalPackages: ['pptxgenjs', 'pdf-parse', 'mammoth'],
};

export default nextConfig;
