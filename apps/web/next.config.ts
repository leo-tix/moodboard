import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent MIME type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Prevent clickjacking
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Enable XSS protection in older browsers
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // Strict referrer policy
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Permissions policy — disable unused browser features. `(self)` autorise
  // le navigateur à MÊME PROPOSER la permission sur notre propre origine —
  // sans ça, `getUserMedia`/`getCurrentPosition` échouent instantanément
  // (NotAllowedError / PERMISSION_DENIED) et le navigateur n'affiche jamais
  // la demande native, quel que soit le choix de l'utilisateur. Microphone
  // (enregistrement carnet) et geolocation ("ma position" à la création
  // d'une visite) sont utilisés ; camera ne l'est pas.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(self)",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // Service worker must never be cached so updates propagate immediately
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Manifest must be fresh for install prompt checks
        source: "/manifest.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },

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

  experimental: {
    // Cache client du routeur : réutilise le RSC d'une page déjà visitée sans
    // repasser par le serveur. Par défaut `dynamic: 0` → chaque retour/arrière
    // ou revisite d'une page dynamique refait un aller-retour serveur (lag
    // perçu). 30 s rend les navigations « aller-retour » quasi-instantanées ;
    // la messagerie a son propre polling et les listes tolèrent 30 s de
    // fraîcheur. `static` = pages sans données par-requête.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
