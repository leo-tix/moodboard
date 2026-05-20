import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Cloudflare R2 public bucket
      {
        protocol: "https",
        hostname: "**.r2.dev",
      },
      // R2 custom domain (si configuré plus tard)
      {
        protocol: "https",
        hostname: "*.r2.cloudflarestorage.com",
      },
    ],
    // Désactive l'optimisation Next.js pour les images R2
    // (on les optimise nous-mêmes avec Sharp avant l'upload)
    unoptimized: false,
    formats: ["image/avif", "image/webp"],
  },

  serverExternalPackages: ["sharp"],
};

export default nextConfig;
