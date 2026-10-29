import type { Metadata } from "next";
import { Suspense } from "react";
import { VideoLinkUrlParam } from "@/components/upload/VideoLinkUrlParam";

export const metadata: Metadata = { title: "Import lien vidéo" };

// Même page que l'onglet "Depuis un lien vidéo" de /upload, mais en route
// dédiée acceptant ?url=… — permet à l'extension Chrome d'ouvrir directement
// ce flux pré-rempli depuis une vidéo survolée sur une page, sans dupliquer
// le pipeline de téléchargement/trim/conversion GIF (apps/gif-worker) côté
// extension (voir YouTubeImportPage, même pattern).
export default function VideoLinkImportPage() {
  return (
    <div className="p-6">
      <header className="mb-8">
        <p className="text-[var(--text-tertiary)] text-xs tracking-widest uppercase mb-1">Import</p>
        <h1 className="text-2xl font-light text-[var(--text-primary)]">Depuis un lien vidéo</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-md">
          Colle un lien TikTok, Instagram ou autre — la vidéo est téléchargée côté serveur puis convertie en GIF.
        </p>
      </header>
      <Suspense>
        <VideoLinkUrlParam />
      </Suspense>
    </div>
  );
}
