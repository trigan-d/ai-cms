import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for a small Docker runtime image (Phase 4 self-host).
  output: "standalone",
  // In the monorepo the workspace root is two levels up; let Next trace files from there.
  // `next build` runs with cwd = apps/studio.
  outputFileTracingRoot: path.join(process.cwd(), "..", ".."),
  // agent-core uses node:child_process / node:fs and the openai SDK — keep them as
  // runtime externals (Node runtime) rather than bundling them into the server build.
  serverExternalPackages: ["@ai-cms/agent-core", "openai"],
};

export default nextConfig;
