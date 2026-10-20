"use client";

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";

// Badge d'alerte "quasi-doublon" pour la fiche détail — réutilise la même
// route que la modale de comparaison des Archives (GET .../duplicates),
// juste pour savoir s'il y a au moins une paire PENDING. Non bloquant :
// un simple signal, l'utilisateur décide s'il archive pour nettoyer.
export function DuplicateBadge({ id }: { id: string }) {
  const [hasDuplicate, setHasDuplicate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/inspirations/${id}/duplicates`)
      .then((r) => (r.ok ? r.json() : { pairs: [] }))
      .then((data) => { if (!cancelled) setHasDuplicate((data.pairs ?? []).length > 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  if (!hasDuplicate) return null;

  return (
    <div className="flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/40 text-amber-400 text-[11px] font-medium px-2.5 py-1.5 rounded-lg">
      <Copy size={12} strokeWidth={2} />
      Quasi-doublon détecté — comparer depuis les Archives une fois archivée
    </div>
  );
}
