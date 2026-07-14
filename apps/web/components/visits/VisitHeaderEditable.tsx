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
  /** "cover" = texte blanc superposé sur la photo de couverture (Phase 5,
   *  demande utilisateur : remonter les infos sur la cover, plus de doublon). */
  variant?: "default" | "cover";
}

// Titre / exposition / date de la visite, éditables inline au clic — relevé à
// l'audit UI/UX : l'API PATCH /api/visits/[id] existait mais AUCUNE UI ne
// permettait de renommer une visite ou corriger sa date après création.
export function VisitHeaderEditable({ visitId, place, exhibition, visitDate, imageCount, variant = "default" }: VisitHeaderEditableProps) {
  const router = useRouter();
  const onCover = variant === "cover";
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

  const inputCls = cn(
    "bg-transparent border-b focus:outline-none transition-colors",
    onCover
      ? "border-white/40 focus:border-white text-white placeholder:text-white/60"
      : "border-[var(--border-default)] focus:border-[var(--text-primary)]",
  );

  // Sur la cover : texte blanc + ombre portée, titre en grand (reprend l'ancien
  // titre statique de la couverture) ; sinon, styles sombres classiques.
  const titleCls = onCover
    ? "text-white font-light text-3xl md:text-5xl leading-[1.05] tracking-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]"
    : "text-xl md:text-2xl font-light text-[var(--text-primary)]";
  const placeholderCls = onCover ? "text-white/70" : "text-[var(--text-tertiary)]";
  const countCls = onCover ? "text-white/70" : "text-[var(--text-tertiary)]";
  const subLineCls = onCover
    ? "text-white/85 drop-shadow-[0_1px_8px_rgba(0,0,0,0.6)]"
    : "text-[var(--text-secondary)]";
  const dotCls = onCover ? "text-white/60" : "text-[var(--text-tertiary)]";

  return (
    <div className="min-w-0">
      {/* Hiérarchie inversée : l'exposition est l'info principale (le lieu
          n'est qu'un contenant), le lieu passe en ligne secondaire. */}
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
          placeholder="Titre de l'exposition"
          className={cn(inputCls, titleCls, "w-full max-w-md")}
        />
      ) : (
        <h1
          onClick={() => setEditingField("exhibition")}
          className={cn(titleCls, "flex items-baseline gap-2 flex-wrap cursor-text group/title")}
          title="Cliquer pour modifier le titre de l'exposition"
        >
          {exhibition || <span className={placeholderCls}>+ Titre de l&apos;exposition</span>}
          <span className={cn("text-sm font-normal", countCls)}>{imageCount}</span>
          <span className={cn("text-xs opacity-0 group-hover/title:opacity-100 pointer-coarse:opacity-100 transition-opacity", countCls)}>✎</span>
        </h1>
      )}

      <p className={cn("text-sm mt-0.5 flex items-center gap-1.5 flex-wrap", subLineCls)}>
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
            className={cn(inputCls, "text-sm w-44")}
          />
        ) : (
          <span
            onClick={() => setEditingField("place")}
            className="cursor-text"
            title="Cliquer pour modifier le lieu"
          >
            {place}
          </span>
        )}
        <span className={dotCls}>·</span>
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
