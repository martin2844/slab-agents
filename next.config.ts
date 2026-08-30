import type { NextConfig } from "next";
import { resolveNextDistDir } from "./lib/next-dist-dir.ts";

const nextConfig: NextConfig = {
  output: "standalone",
  // Never let a verification build replace the artifacts used by the live
  // development server. Mixing those graphs leaves open tabs executing stale
  // React modules against a newer RSC payload.
  distDir: resolveNextDistDir(),
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // SQLite is a single local control-plane database. Serial page collection
    // avoids loading the native driver in a large build-worker fan-out.
    cpus: 1,
  },
};

export default nextConfig;
