"use client";

import { useState } from "react";
import { BookmarkPlus, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Bouton « Enregistrer dans ma bibliothèque » pour une image d'une collection
// partagée qui n'est pas la mienne (copie R2 indépendante via
// /api/collections/[id]/save).
export function SaveToLibraryButton({ collectionId, imageId, className }: { collectionId: string; imageId: string; className?: string }) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  const save = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (state !== "idle") return;
    setState("saving");
    const r = await fetch(`/api/collections/${collectionId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId }),
    });
    setState(r.ok ? "saved" : "idle");
  };

  return (
    <button
      onClick={save}
      disabled={state !== "idle"}
      title={state === "saved" ? "Ajoutée à ta bibliothèque" : "Enregistrer dans ma bibliothèque"}
      className={cn(
        "w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 disabled:opacity-100 transition-colors",
        className,
      )}
    >
      {state === "saving" ? <Loader2 size={12} className="animate-spin" /> : state === "saved" ? <Check size={12} strokeWidth={2.5} className="text-[var(--accent,#a78bfa)]" /> : <BookmarkPlus size={12} strokeWidth={2} />}
    </button>
  );
}
