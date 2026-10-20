"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { getImageUrl } from "@/lib/storage/urls";

interface DuplicatePairSide {
  id: string;
  title: string;
  createdAt: string;
  isArchived: boolean;
  images: { storageKey: string | null; thumbnailKey: string | null }[];
}
interface DuplicatePair {
  candidateId: string;
  similarity: number;
  other: DuplicatePairSide;
}

// Modale "comparer & supprimer" — point d'entrée : clic sur le badge
// doublon d'une carte archivée. Montre la paire connue directement (pas de
// sélection manuelle), l'utilisateur choisit laquelle garder. La fusion
// (tags/catégories/collections + repointage moodboards/visites) est gérée
// côté serveur par POST /api/inspirations/merge.
export function CompareDuplicateModal({ id, title, thumbnailUrl, onClose, onMerged }: {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/inspirations/${id}/duplicates`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setPairs(data.pairs ?? []); })
      .catch(() => { if (!cancelled) setPairs([]); });
    return () => { cancelled = true; };
  }, [id]);

  const merge = async (keepId: string, deleteId: string) => {
    setMerging(deleteId);
    setError(null);
    try {
      const res = await fetch("/api/inspirations/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepId, deleteId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "La fusion a échoué.");
        setMerging(null);
        return;
      }
      onMerged();
    } catch {
      setError("La fusion a échoué.");
      setMerging(null);
    }
  };

  const thumb = (side: { images: { storageKey: string | null; thumbnailKey: string | null }[] }) => {
    const img = side.images[0];
    const key = img?.thumbnailKey ?? img?.storageKey ?? null;
    return key ? getImageUrl(key) : null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-base)] border border-[var(--border-default)] rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium text-[var(--text-primary)]">Quasi-doublon — {title}</p>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {pairs === null && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-[var(--text-tertiary)]" />
          </div>
        )}

        {pairs !== null && pairs.length === 0 && (
          <p className="text-xs text-[var(--text-tertiary)] py-6 text-center">
            Plus aucune paire de doublons en attente pour cette image.
          </p>
        )}

        {error && <p className="text-[11px] text-red-400 mb-3">{error}</p>}

        {pairs?.map((pair) => (
          <div key={pair.candidateId} className="mb-5 last:mb-0">
            <p className="text-[10px] text-[var(--text-tertiary)] mb-2">
              Similarité {(pair.similarity * 100).toFixed(1)}%
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id, title, img: thumbnailUrl },
                { id: pair.other.id, title: pair.other.title, img: thumb(pair.other) },
              ].map((side) => (
                <div key={side.id} className="space-y-2">
                  <div className="aspect-square rounded-lg overflow-hidden bg-[var(--bg-surface)]">
                    {side.img ? (
                      <img src={side.img} alt={side.title} className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] truncate">{side.title}</p>
                  <button
                    type="button"
                    disabled={merging !== null}
                    onClick={() => merge(side.id, side.id === id ? pair.other.id : id)}
                    className="w-full py-1.5 text-[11px] rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-50 transition-colors"
                  >
                    {merging === (side.id === id ? pair.other.id : id) ? (
                      <Loader2 size={12} className="animate-spin inline" />
                    ) : (
                      "Garder celle-ci"
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
