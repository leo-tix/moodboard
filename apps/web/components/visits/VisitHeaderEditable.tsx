"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface VisitHeaderEditableProps {
  visitId: string;
  place: string;
  exhibition: string | null;
  visitDate: string; // ISO
  imageCount: number;
}

// Titre / exposition / date de la visite, éditables inline au clic — relevé à
// l'audit UI/UX : l'API PATCH /api/visits/[id] existait mais AUCUNE UI ne
// permettait de renommer une visite ou corriger sa date après création.
export function VisitHeaderEditable({ visitId, place, exhibition, visitDate, imageCount }: VisitHeaderEditableProps) {
  const router = useRouter();
  const [editingField, setEditingField] = useState<"place" | "exhibition" | "date" | null>(null);
  const [localPlace, setLocalPlace] = useState(place);
  const [localExhibition, setLocalExhibition] = useState(exhibition ?? "");
  const [localDate, setLocalDate] = useState(visitDate.slice(0, 10));

  const patch = async (data: Record<string, unknown>) => {
    await fetch(`/api/visits/${visitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).catch(() => {});
    router.refresh();
  };

  const savePlace = () => {
    setEditingField(null);
    const v = localPlace.trim();
    if (!v || v === place) { setLocalPlace(place); return; }
    patch({ place: v });
  };

  const saveExhibition = () => {
    setEditingField(null);
    const v = localExhibition.trim();
    if (v === (exhibition ?? "")) return;
    patch({ exhibition: v || null });
  };

  const saveDate = () => {
    setEditingField(null);
    if (!localDate || localDate === visitDate.slice(0, 10)) return;
    patch({ visitDate: localDate });
  };

  const dateLabel = new Date(visitDate).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });

  const inputCls =
    "bg-transparent border-b border-[var(--border-default)] focus:border-[var(--text-primary)] focus:outline-none transition-colors";

  return (
    <div className="min-w-0">
      {editingField === "place" ? (
        <input
          autoFocus
          value={localPlace}
          onChange={(e) => setLocalPlace(e.target.value)}
          onBlur={savePlace}
          onKeyDown={(e) => {
            if (e.key === "Enter") savePlace();
            if (e.key === "Escape") { setLocalPlace(place); setEditingField(null); }
          }}
          className={cn(inputCls, "text-xl md:text-2xl font-light text-[var(--text-primary)] w-full max-w-md")}
        />
      ) : (
        <h1
          onClick={() => setEditingField("place")}
          className="text-xl md:text-2xl font-light text-[var(--text-primary)] flex items-baseline gap-2 flex-wrap cursor-text group/title"
          title="Cliquer pour renommer"
        >
          {place}
          <span className="text-sm font-normal text-[var(--text-tertiary)]">{imageCount}</span>
          <span className="text-xs text-[var(--text-tertiary)] opacity-0 group-hover/title:opacity-100 pointer-coarse:opacity-100 transition-opacity">✎</span>
        </h1>
      )}

      <p className="text-sm text-[var(--text-secondary)] mt-0.5 flex items-center gap-1.5 flex-wrap">
        {editingField === "exhibition" ? (
          <input
            autoFocus
            value={localExhibition}
            onChange={(e) => setLocalExhibition(e.target.value)}
            onBlur={saveExhibition}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveExhibition();
              if (e.key === "Escape") { setLocalExhibition(exhibition ?? ""); setEditingField(null); }
            }}
            placeholder="Nom de l'exposition"
            className={cn(inputCls, "italic text-sm w-44")}
          />
        ) : (
          <span
            onClick={() => setEditingField("exhibition")}
            className="italic cursor-text"
            title="Cliquer pour modifier l'exposition"
          >
            {exhibition || <span className="text-[var(--text-tertiary)] not-italic">+ exposition</span>}
          </span>
        )}
        <span className="text-[var(--text-tertiary)]">·</span>
        {editingField === "date" ? (
          <input
            autoFocus
            type="date"
            value={localDate}
            onChange={(e) => setLocalDate(e.target.value)}
            onBlur={saveDate}
            onKeyDown={(e) => { if (e.key === "Enter") saveDate(); }}
            className={cn(inputCls, "text-sm")}
          />
        ) : (
          <span onClick={() => setEditingField("date")} className="cursor-text" title="Cliquer pour changer la date">
            {dateLabel}
          </span>
        )}
      </p>
    </div>
  );
}
