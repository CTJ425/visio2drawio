import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: `next build` writes plain HTML/JS/CSS to `out/`, which is what
  // Cloudflare Pages serves. Conversion runs in the browser (public/wasm), so no
  // server runtime is needed.
  output: "export",
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
};

export default nextConfig;
