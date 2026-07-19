// Façade TYPÉE du vocabulaire d'analyse d'image. Les données réelles vivent dans
// imageVocab.data.mjs (plain JS) — source de vérité UNIQUE partagée avec les
// scripts Node (générateur d'embeddings, harnais de test) pour garantir que
// l'ordre flatConcepts() est identique offline et au runtime. Ce fichier ne fait
// qu'ajouter les types TypeScript par-dessus.

import {
  CATEGORY_CONCEPTS as _CATEGORY_CONCEPTS,
  TAG_GROUPS as _TAG_GROUPS,
  flatConcepts as _flatConcepts,
  siglipText as _siglipText,
  PROMPT_TEMPLATES as _PROMPT_TEMPLATES,
} from "./imageVocab.data.mjs";

export interface CategoryConcept {
  category: string;
  subcategory: string;
  prompt: string;
}

export interface TagConcept {
  label: string;
  prompt: string;
}

export type FlatConcept =
  | { kind: "category"; prompt: string; category: string; subcategory: string }
  | { kind: "tag"; prompt: string; group: string; label: string };

export const CATEGORY_CONCEPTS = _CATEGORY_CONCEPTS as CategoryConcept[];
export const TAG_GROUPS = _TAG_GROUPS as Record<string, TagConcept[]>;
export const PROMPT_TEMPLATES = _PROMPT_TEMPLATES as string[];

export function flatConcepts(): FlatConcept[] {
  return _flatConcepts() as FlatConcept[];
}

export function siglipText(prompt: string, template?: string): string {
  return _siglipText(prompt, template);
}

// Tous les concepts de tags à plat (mapping prompt→label côté moteur).
export const TAG_CONCEPTS: TagConcept[] = Object.values(TAG_GROUPS).flat();
