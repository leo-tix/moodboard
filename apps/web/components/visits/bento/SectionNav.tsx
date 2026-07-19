"use client";

import { Route } from "lucide-react";
import type { BentoTile } from "@/lib/visits/bentoTypes";

// Parcours de la visite — sommaire des sections en TIMELINE verticale (trait
// vertical reliant les chapitres, 2026-07-19). Apparaît dès qu'un séparateur
// existe. Chaque puce défile jusqu'à sa section (ancre `sep-<id>`).
export function SectionNav({ tiles }: { tiles: BentoTile[] }) {
  const sections = tiles.filter((t) => t.content.type === "separator");
  if (sections.length === 0) return null;

  const go = (id: string) => {
    document.getElementById(`sep-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav aria-label="Parcours de la visite" className="mb-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Route size={15} strokeWidth={2} className="text-[var(--text-tertiary)]" />
        <span className="text-[11px] uppercase tracking-widest text-[var(--text-tertiary)] font-medium">Parcours de la visite</span>
      </div>
      <ol className="relative">
        {/* Trait vertical reliant les chapitres. */}
        <span aria-hidden className="absolute left-[5px] top-3 bottom-3 w-px bg-[var(--border-default)]" />
        {sections.map((t) => {
          const label = t.content.type === "separator" ? t.content.label.trim() || "Section" : "";
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => go(t.id)}
                className="group flex items-start gap-3 w-full text-left py-1.5"
              >
                <span className="relative z-10 mt-[3px] w-[11px] h-[11px] shrink-0 rounded-full border-2 border-[var(--border-default)] bg-[var(--bg-base)] group-hover:border-[var(--text-primary)] group-hover:bg-[var(--text-primary)] transition-colors" />
                <span className="text-[13px] leading-snug text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
