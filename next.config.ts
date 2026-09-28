import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['xlsx', 'mammoth', 'unpdf', 'jszip'],
  // FAQ & Guides rejects files over 100 MB in the upload route. This only
  // applies when a Next.js proxy buffers the body; the default is 10 MB and
  // would truncate a larger file before that check. 120 MB leaves room for
  // the multipart envelope around a 100 MB file.
  experimental: {
    proxyClientMaxBodySize: '120mb',
  },
};

export default nextConfig;
