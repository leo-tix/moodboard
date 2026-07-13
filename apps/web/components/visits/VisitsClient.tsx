"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";

export interface VisitCard {
  id: string;
  place: string;
  exhibition: string | null;
  visitDate: string;
  notes: string | null;
  count: number;
  thumbnails: string[];
  tags: string[];
}

// Groupe les visites par année pour une lecture chronologique type carnet
function groupByYear(visits: VisitCard[]): [string, VisitCard[]][] {
  const map = new Map<string, VisitCard[]>();
  for (const v of visits) {
    const year = new Date(v.visitDate).getFullYear().toString();
    if (!map.has(year)) map.set(year, []);
    map.get(year)!.push(v);
  }
  return Array.from(map.entries());
}

export function VisitsClient({ initialVisits, allTags = [] }: { initialVisits: VisitCard[]; allTags?: string[] }) {
  const [visits, setVisits] = useState(initialVisits);
  // Filtrage transversal par tags (Phase 5) : une visite passe le filtre si elle
  // porte au moins un des tags sélectionnés (OU).
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const filtered = useMemo(
    () => (activeTags.length === 0 ? visits : visits.filter((v) => v.tags.some((t) => activeTags.includes(t)))),
    [visits, activeTags],
  );
  const groups = useMemo(() => groupByYear(filtered), [filtered]);

  const toggleTag = (t: string) =>
    setActiveTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer cette visite ? Les images ne seront pas supprimées, seulement détachées.")) return;
    setVisits((prev) => prev.filter((v) => v.id !== id));
    await fetch(`/api/visits/${id}`, { method: "DELETE" }).catch(() => {});
  };

  if (visits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <p className="text-3xl opacity-20">🏛</p>
        <p className="text-[var(--text-tertiary)] text-sm max-w-sm">
          Aucune visite pour l&apos;instant. Lors d&apos;un import, active
          «&nbsp;Contexte de visite&nbsp;» pour regrouper les photos d&apos;un musée ou d&apos;une expo ici.
        </p>
        <Link
          href="/upload"
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          Ajouter des images →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((t) => {
            const active = activeTags.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleTag(t)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs transition-colors border",
                  active
                    ? "bg-[var(--text-primary)] text-[var(--bg-base)] border-transparent"
                    : "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]",
                )}
              >
                #{t}
              </button>
            );
          })}
          {activeTags.length > 0 && (
            <button
              onClick={() => setActiveTags([])}
              className="px-2.5 py-1 rounded-full text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
            >
              ✕ tout afficher
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)] py-12 text-center">
          Aucune visite ne porte {activeTags.length > 1 ? "ces tags" : "ce tag"}.
        </p>
      ) : (
        <div className="space-y-10">
          {groups.map(([year, yearVisits]) => (
            <section key={year}>
              <h2 className="font-serif text-2xl md:text-3xl font-semibold text-[var(--text-primary)] tracking-tight mb-4">
                {year}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {yearVisits.map((v) => (
                  <VisitCardView key={v.id} visit={v} onDelete={handleDelete} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function VisitCardView({
  visit,
  onDelete,
}: {
  visit: VisitCard;
  onDelete: (id: string) => void;
}) {
  const date = new Date(visit.visitDate).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
  });

  return (
    <Link
      href={`/visites/${visit.id}`}
      className="group relative rounded-lg border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-elevated)] hover:border-[var(--border-default)] transition-colors block"
    >
      {/* Mosaïque 2×2 */}
      <div className="aspect-video grid grid-cols-2 grid-rows-2 gap-px bg-[var(--bg-base)]">
        {Array.from({ length: 4 }).map((_, i) => {
          const key = visit.thumbnails[i];
          return key ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={getThumbnailUrl(key)}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : (
            <div key={i} className="w-full h-full bg-[var(--bg-surface)]" />
          );
        })}
      </div>

      {/* Info */}
      <div className="px-3 py-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          {visit.exhibition ? (
            <>
              <p className="font-serif text-base text-[var(--text-primary)] truncate leading-tight">
                {visit.exhibition}
              </p>
              <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">{visit.place}</p>
            </>
          ) : (
            <p className="font-serif text-base text-[var(--text-primary)] truncate leading-tight">
              {visit.place}
            </p>
          )}
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
            {date} · {visit.count} image{visit.count !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(visit.id);
          }}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 w-6 h-6 flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-400 transition-all text-xs"
          title="Supprimer la visite"
        >
          ✕
        </button>
      </div>
    </Link>
  );
}
