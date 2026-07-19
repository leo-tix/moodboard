"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

// Réglage « analyser automatiquement les images » (suggestions IA locales).
// Persisté en localStorage, PARTAGÉ entre le triage et les espaces d'upload.
// Un event custom synchronise les instances montées en même temps (le storage
// event natif ne se déclenche qu'entre onglets).
export const AI_AUTOSUGGEST_KEY = "mb-ai-autosuggest";
const CHANGED_EVENT = "mb-ai-autosuggest-changed";

export function useAiAutoSuggest(): [boolean, () => void] {
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    const read = () => {
      try { setAuto(localStorage.getItem(AI_AUTOSUGGEST_KEY) === "1"); } catch { /* pas de storage */ }
    };
    read();
    window.addEventListener(CHANGED_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(CHANGED_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  const toggle = useCallback(() => {
    try {
      const next = localStorage.getItem(AI_AUTOSUGGEST_KEY) !== "1";
      localStorage.setItem(AI_AUTOSUGGEST_KEY, next ? "1" : "0");
    } catch { /* pas de storage */ }
    window.dispatchEvent(new Event(CHANGED_EVENT));
  }, []);
  return [auto, toggle];
}

/** Interrupteur réutilisable (marque + libellé). */
export function Switch({ on, onToggle, title }: { on: boolean; onToggle: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      role="switch"
      aria-checked={on}
      className={cn("relative w-9 h-5 rounded-full transition-colors shrink-0", on ? "bg-[var(--text-primary)]" : "bg-[var(--border-default)]")}
    >
      <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-[var(--bg-base)] transition-all", on ? "left-[1.125rem]" : "left-0.5")} />
    </button>
  );
}

// Bloc autonome pour les espaces d'upload : titre + switch + mention « local ».
export function AiAutoSuggestToggle() {
  const [auto, toggle] = useAiAutoSuggest();
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-center gap-3">
        <span className="w-8 h-8 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center shrink-0">
          <Sparkles size={15} strokeWidth={2} className="text-[var(--text-secondary)]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-[var(--text-primary)] leading-tight">Suggestions IA automatiques</p>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">Analyse chaque image importée pour proposer catégories &amp; tags.</p>
        </div>
        <Switch on={auto} onToggle={toggle} title="Analyser automatiquement les images" />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
        <ShieldCheck size={12} strokeWidth={2} className="text-emerald-500/80 shrink-0" />
        Analyse 100 % locale, sur ton appareil — aucune image n&apos;est envoyée à un serveur.
      </p>
    </div>
  );
}
