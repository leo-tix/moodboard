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

// STOCKAGE PERSISTANT — sans ça, le navigateur peut évincer IndexedDB sous
// pression disque, et une visite de musée en attente (50-100 Mo de photos)
// serait perdue. Voir docs/carnet-hors-ligne.md §6.
if(navigator.storage && navigator.storage.persist){
  navigator.storage.persisted().then(function(ok){ if(!ok) navigator.storage.persist().catch(function(){}); }).catch(function(){});
}

// PRÉCHAUFFAGE DE LA COQUILLE HORS LIGNE — le service worker met en cache le
// HTML de /hors-ligne à l'installation, mais PAS les bundles JS de la route,
// qui sont des requêtes distinctes : sans eux la page ne s'hydraterait pas
// sans réseau. On la charge donc une fois dans une iframe invisible, ce qui
// fait passer tous ses sous-fichiers par le worker, qui les met en cache.
// Une seule fois par session, au repos, et uniquement en ligne.
(function(){
  try{
    if(!('serviceWorker' in navigator) || !navigator.onLine) return;
    if(location.pathname === '/hors-ligne') return;
    if(sessionStorage.getItem('mb-offline-warm')) return;
    var run = function(){
      sessionStorage.setItem('mb-offline-warm','1');
      var f = document.createElement('iframe');
      f.setAttribute('aria-hidden','true');
      f.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none';
      f.src = '/hors-ligne';
      f.onload = function(){ setTimeout(function(){ f.remove(); }, 2000); };
      document.body.appendChild(f);
    };
    if('requestIdleCallback' in window) requestIdleCallback(run,{timeout:8000});
    else setTimeout(run,4000);
  }catch(e){}
})();
`.trim(),
          }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
