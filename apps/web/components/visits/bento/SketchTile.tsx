"use client";

import { PenLine } from "lucide-react";
import { getThumbnailUrl } from "@/lib/storage/urls";
import type { JournalTileContent } from "@/lib/visits/bentoTypes";

type SketchContent = Extract<JournalTileContent, { type: "sketch" }>;

// Tuile croquis — affiche le PNG dessiné (fond papier inclus dans l'image).
export function SketchTile({ content, fitContain }: { content: SketchContent; fitContain?: boolean }) {
  const key = content.thumbnailKey ?? content.storageKey;
  if (!key) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">
        <PenLine size={20} strokeWidth={1.75} />
      </div>
    );
  }
  if (fitContain) {
    // Ratio d'origine : croquis entier, marge + coins arrondis.
    return (
      <div className="w-full h-full flex items-center justify-center p-2 bg-[var(--bg-surface)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={getThumbnailUrl(key)} alt="Croquis" loading="lazy" draggable={false} className="max-w-full max-h-full w-auto h-auto object-contain rounded-xl bg-[#f7f5ef]" />
      </div>
    );
  }
  return (
    <div className="w-full h-full bg-[#f7f5ef]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={getThumbnailUrl(key)} alt="Croquis" loading="lazy" draggable={false} className="w-full h-full object-cover" />
    </div>
  );
}
