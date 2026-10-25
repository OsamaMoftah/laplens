import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.LAPLENS_STATIC_EXPORT === "1" ? "export" : "standalone",
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
