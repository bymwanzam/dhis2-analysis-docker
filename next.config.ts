import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server in .next/standalone with only the packages it
  // needs: what scripts/bundle-cpanel.mjs uploads to cPanel (DEPLOY-CPANEL.md).
  output: "standalone",
};

export default nextConfig;
