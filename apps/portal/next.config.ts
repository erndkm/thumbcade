import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const config: NextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],
  transpilePackages: ["@thumbcade/protocol", "@thumbcade/design-tokens", "@thumbcade/legal", "@thumbcade/swipe-contract", "@thumbcade/sdk"],
  typedRoutes: false,
  agentRules: false,
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "127.0.0.1", port: "54321" },
      { protocol: "http", hostname: "localhost", port: "54321" },
      { protocol: "https", hostname: "**.supabase.co" },
    ],
  },
};

const withMDX = createMDX({
  options: {
    // Turbopack requires serializable plugin references.
    remarkPlugins: [["remark-gfm", {}]],
  },
});

export default withMDX(config);
