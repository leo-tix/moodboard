"use client";

import { List } from "lucide-react";
import type { BentoTile } from "@/lib/visits/bentoTypes";

// Sommaire des sections — apparaît en haut du carnet dès qu'un séparateur est
// présent (2026-07-19). Chaque puce défile jusqu'à la section correspondante
// (ancre `sep-<id>` posée par BentoTile).
export function SectionNav({ tiles }: { tiles: BentoTile[] }) {
  const sections = tiles.filter((t) => t.content.type === "separator");
  if (sections.length === 0) return null;

  const go = (id: string) => {
    document.getElementById(`sep-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav aria-label="Sections du carnet" className="mb-5 flex items-center gap-2 overflow-x-auto pb-1">
      <List size={15} strokeWidth={2} className="shrink-0 text-[var(--text-tertiary)]" />
      {sections.map((t) => {
        const label = t.content.type === "separator" ? t.content.label.trim() || "Section" : "";
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => go(t.id)}
            className="shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)] transition-colors"
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
