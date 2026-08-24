import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "10.8.22.99",
    "10.*",
    "192.168.*",
    "172.*",
    "*.local",
    "*.internal",
    "*.corp.google.com",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
