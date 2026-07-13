import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Serif arrondi pour les titres du carnet (H2 du bloc texte) — Fraunces a des
// terminaisons douces/arrondies (variable "soft"), très différenciée de la
// sans-serif du reste de l'UI, esprit éditorial/musée.
const fraunces = Fraunces({
  variable: "--font-serif",
  subsets: ["latin"],
  axes: ["SOFT"],
  style: ["normal", "italic"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // safe-area-inset for notched phones
};

export const metadata: Metadata = {
  title: {
    default: "Moodboard",
    template: "%s — Moodboard",
  },
  description: "Atlas visuel personnel",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').then(function(reg){
    // Force an update check on every load — sw.js is served no-cache,
    // so this reliably picks up a new worker instead of waiting up to 24h.
    reg.update().catch(function(){});
    document.addEventListener('visibilitychange', function(){
      if(document.visibilityState === 'visible') reg.update().catch(function(){});
    });
  }).catch(function(){});
  var reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if(reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaPrompt=e;});
`.trim(),
          }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
