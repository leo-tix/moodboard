"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3 3.6 5.2a1 1 0 0 0-.6.9v13.4a.5.5 0 0 0 .7.5L9 18l6 3 5.4-2.2a1 1 0 0 0 .6-.9V4.5a.5.5 0 0 0-.7-.5L15 6 9 3Z" />
          <path d="M9 3v15" /><path d="M15 6v15" />
        </svg>
        Carte
      </Link>
      <button
        onClick={() => setShowCreate(true)}
        className="px-3 py-1.5 text-sm bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-md text-[var(--text-primary)] transition-colors"
      >
        + Nouvelle visite
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
