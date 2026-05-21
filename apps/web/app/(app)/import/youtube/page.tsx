import type { Metadata } from "next";
import { YouTubeImportClient } from "@/components/youtube/YouTubeImportClient";

export const metadata: Metadata = { title: "Import YouTube" };

export default function YouTubeImportPage() {
  return (
    <div className="p-6">
      <header className="mb-8">
        <p className="text-[var(--text-tertiary)] text-xs tracking-widest uppercase mb-1">Import</p>
        <h1 className="text-2xl font-light text-[var(--text-primary)]">YouTube</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-md">
          Extrayez 5 stills ou composez une mosaïque 3×3 depuis n&apos;importe quelle vidéo.
        </p>
      </header>
      <YouTubeImportClient />
    </div>
  );
}
