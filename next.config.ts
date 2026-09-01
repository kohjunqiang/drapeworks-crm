import type { NextConfig } from "next";

// Allow next/image to optimize photos served from our Supabase Storage host.
// Derived from the public URL so it stays correct across environments.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  output: "standalone",
  // Local QA is opened from other devices through this machine's LAN address.
  // Without allowing that origin, Next blocks the development client bundles:
  // the HTML renders, but buttons and enhanced forms never hydrate.
  allowedDevOrigins: ["192.168.18.98"],
  // The purchase-order renderer reads its CJK font off disk at runtime
  // (src/lib/po/render.ts). Standalone output traces IMPORTS, so a file only
  // ever opened by fs is left behind — and the failure mode is a PDF whose
  // Chinese cells are blank rather than an error, working perfectly in dev and
  // arriving empty at the factory.
  outputFileTracingIncludes: {
    "/**": ["./assets/fonts/*.ttf"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  images: {
    // Optimized thumbnails rarely change — keep them on disk for a week.
    minimumCacheTTL: 7 * 24 * 60 * 60,
    remotePatterns: supabaseHost
      ? [
          {
            protocol: "https",
            hostname: supabaseHost,
            pathname: "/storage/v1/**",
          },
        ]
      : [],
  },
};

export default nextConfig;
