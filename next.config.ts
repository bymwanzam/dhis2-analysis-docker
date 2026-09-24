import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server in .next/standalone with only the packages it
  // needs, which keeps the runtime image small. See Dockerfile.
  output: "standalone",
};

export default nextConfig;
