import type { NextConfig } from "next";

// Allow next/image to optimize photos served from our Supabase Storage host.
// Derived from the public URL so it stays correct across environments.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  output: "standalone",
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
