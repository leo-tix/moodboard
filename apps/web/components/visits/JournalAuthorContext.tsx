"use client";

import { createContext, useContext } from "react";

export interface JournalAuthor {
  name: string | null;
  image: string | null;
}

// Auteur du carnet (propriétaire de la visite) — une seule valeur pour tout
// l'arbre du journal, évite de la faire traverser chaque callback des blocs
// imbriqués (ColumnStack, etc.) juste pour atteindre AudioBlockContent.
const JournalAuthorContext = createContext<JournalAuthor>({ name: null, image: null });

export const JournalAuthorProvider = JournalAuthorContext.Provider;

export function useJournalAuthor(): JournalAuthor {
  return useContext(JournalAuthorContext);
}
