/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Allow mobile devices on the LAN to reach the dev server (presenter remote)
  // and Electron's 127.0.0.1 origin during development.
  allowedDevOrigins: ['*', 'http://127.0.0.1:3000'],
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
