import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['xlsx', 'mammoth', 'unpdf', 'jszip'],
};

export default nextConfig;
