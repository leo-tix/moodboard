import type { NextConfig } from "next";

// Content-Security-Policy.
//
// Volontairement tolérante sur les SOURCES DE DONNÉES (connect-src/img-src en
// `https:`) : l'app télécharge ses modèles d'IA embarquée (transformers.js,
// tesseract.js) et ses tuiles de carte depuis des CDN tiers, et une liste
// blanche stricte les casserait au premier changement d'hébergement côté
// éditeur. Ce qu'elle verrouille en revanche, c'est l'EXÉCUTION et la
// NAVIGATION : `object-src 'none'` (plugins), `base-uri 'self'` (détournement
// des URL relatives), `form-action 'self'` (exfiltration d'un POST vers un
// domaine tiers), `frame-ancestors 'self'` (clickjacking, version moderne de
// X-Frame-Options).
//
// `unsafe-inline` reste nécessaire pour le script d'enregistrement du service
// worker (app/layout.tsx) et les styles en ligne de Tailwind/Framer Motion ;
// `wasm-unsafe-eval` + `blob:` pour les Web Workers WASM de la transcription
// audio et de l'OCR. La défense contre le XSS repose donc sur
// l'assainissement du HTML (lib/security/sanitizeHtml.ts), pas sur cette
// politique — passer à une CSP à nonce imposerait le rendu dynamique de
// toutes les pages (cf. docs/securite.md).
const isDev = process.env.NODE_ENV === "development";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net https://unpkg.com${isDev ? " 'unsafe-eval'" : ""}`,
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data: https:",
  // Lecteur YouTube intégré aux carnets de visite.
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

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
  { key: "Content-Security-Policy", value: csp },
  // HSTS : une fois la page servie en HTTPS, le navigateur refuse tout retour
  // en clair pendant deux ans (interdit le vol de cookie de session par
  // rétrogradation sur un réseau hostile). Sans effet en développement local,
  // les navigateurs ignorant l'en-tête sur http://localhost.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
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
