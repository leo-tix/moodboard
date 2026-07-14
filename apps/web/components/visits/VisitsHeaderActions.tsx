"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Map as MapIcon, Plus } from "lucide-react";
import { CreateVisitModal } from "@/components/visits/CreateVisitModal";

// Actions du header de /visites : accès à la carte cumulée + création d'une
// visite vide (sans passer par l'upload ou le drag bibliothèque — trou
// fonctionnel relevé à l'audit UI/UX : aucun autre chemin de création direct).
export function VisitsHeaderActions() {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <Link
        href="/visites/carte"
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-md text-[var(--text-primary)] transition-colors"
      >
        <MapIcon size={14} strokeWidth={1.8} />
        Carte
      </Link>
      <button
        onClick={() => setShowCreate(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-md text-[var(--text-primary)] transition-colors"
      >
        <Plus size={14} strokeWidth={2} /> Nouvelle visite
      </button>

      {showCreate && (
        <CreateVisitModal
          inspirationIds={[]}
          onClose={() => setShowCreate(false)}
          onCreated={(visitId) => router.push(`/visites/${visitId}`)}
        />
      )}
    </div>
  );
}
