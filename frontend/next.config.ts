import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emits .next/standalone with a self-contained server.js and only the
  // node_modules actually traced as reachable. Needed for the Docker image:
  // without it the runtime stage would have to ship devDependencies just so
  // Next could parse THIS file (it is TypeScript). Vercel ignores this setting
  // and uses its own adapter, so the hosted deploy is unaffected.
  output: "standalone",
};

export default nextConfig;
