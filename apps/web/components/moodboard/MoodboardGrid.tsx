"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MoodboardData } from "@/lib/moodboard/types";

interface Props {
  initialMoodboards: MoodboardData[];
}

export function MoodboardGrid({ initialMoodboards }: Props) {
  const router = useRouter();
  const [moodboards, setMoodboards] = useState(initialMoodboards);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/moodboards", { method: "POST" });
      const data = await res.json();
      router.push(`/moodboards/${data.id}/edit`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer cette planche ?")) return;
    await fetch(`/api/moodboards/${id}`, { method: "DELETE" });
    setMoodboards((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-medium text-[var(--text-primary)]">Planches</h1>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="px-3 py-1.5 text-sm bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-md text-[var(--text-primary)] transition-colors disabled:opacity-50"
        >
          {creating ? "Création…" : "+ Nouvelle planche"}
        </button>
      </div>

      {/* Grid */}
      {moodboards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <p className="text-[var(--text-tertiary)] text-sm">Aucune planche pour l&apos;instant</p>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Créer ma première planche →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {moodboards.map((m) => (
            <MoodboardCard key={m.id} moodboard={m} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function MoodboardCard({
  moodboard,
  onDelete,
}: {
  moodboard: MoodboardData;
  onDelete: (id: string) => void;
}) {
  const router = useRouter();
  const imageCount = moodboard.canvasData.filter((el) => el.type === "image").length;
  const updatedAt = new Date(moodboard.updatedAt).toLocaleDateString("fr-FR", {
    day: "numeric", month: "short", year: "numeric",
  });

  return (
    <div
      className="group relative rounded-lg border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-elevated)] cursor-pointer hover:border-[var(--border-default)] transition-colors"
      onClick={() => router.push(`/moodboards/${moodboard.id}/edit`)}
    >
      {/* Canvas preview */}
      <div
        className="aspect-video w-full flex items-center justify-center text-[var(--text-tertiary)] text-xs"
        style={{ backgroundColor: moodboard.background }}
      >
        {imageCount === 0 && <span className="opacity-40">Planche vide</span>}
      </div>

      {/* Info */}
      <div className="px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-[var(--text-primary)] truncate">{moodboard.title}</p>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{updatedAt} · {imageCount} image{imageCount !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(moodboard.id); }}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-400 transition-all text-xs"
          title="Supprimer"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
