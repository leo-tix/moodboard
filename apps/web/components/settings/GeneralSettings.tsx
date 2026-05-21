"use client";

import { useState, useEffect } from "react";

export const AI_IMPORT_KEY = "moodboard:aiOnImport";

export function GeneralSettings() {
  const [aiOnImport, setAiOnImport] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setAiOnImport(localStorage.getItem(AI_IMPORT_KEY) === "true");
  }, []);

  const toggle = () => {
    const next = !aiOnImport;
    setAiOnImport(next);
    localStorage.setItem(AI_IMPORT_KEY, String(next));
  };

  if (!mounted) return null;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-widest">Planches d&apos;ambiance</p>

        <div className="flex items-start justify-between gap-6 py-3 border-b border-[var(--border-subtle)]">
          <div>
            <p className="text-sm text-[var(--text-primary)]">Analyse IA automatique à l&apos;import</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
              Lors d&apos;un glisser-déposer ou d&apos;un collage (Ctrl+V) dans une planche, analyser automatiquement chaque image via Gemini pour extraire titre, tags et humeur.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={aiOnImport}
            onClick={toggle}
            className={`flex-shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
              aiOnImport ? "bg-[var(--accent,#a78bfa)]" : "bg-[var(--bg-elevated)]"
            } border border-[var(--border-default)]`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                aiOnImport ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </section>
    </div>
  );
}
