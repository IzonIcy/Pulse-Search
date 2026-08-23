import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with only the traced runtime deps, so the
  // production Docker image doesn't ship the entire node_modules tree.
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
