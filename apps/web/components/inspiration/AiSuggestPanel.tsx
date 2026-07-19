"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Check, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Category } from "@/components/inspiration/CategorySelect";
import type { CategorySelection } from "@/components/inspiration/CategoryMultiSelect";
import { analyzeImage, type AnalysisProgress, type ImageAnalysis } from "@/lib/ai/imageAnalysis";

export const AI_AUTOSUGGEST_KEY = "mb-ai-autosuggest";

interface Props {
  /** URL publique de l'image à analyser. */
  imageUrl: string | null;
  allCategories: Category[];
  currentCategories: CategorySelection[];
  currentTags: string[];
  onAddCategory: (sel: CategorySelection) => void;
  onAddTag: (name: string) => void;
}

// Panneau de suggestions IA (locale) — analyse l'image via CLIP (zero-shot, en
// Web Worker) et propose catégories + tags. L'utilisateur clique ce qu'il garde,
// rien n'est appliqué d'office. Un toggle « auto » relance l'analyse dès qu'une
// nouvelle image s'affiche (persisté en localStorage, partagé avec les espaces
// d'upload).
export function AiSuggestPanel({ imageUrl, allCategories, currentCategories, currentTags, onAddCategory, onAddTag }: Props) {
  const [auto, setAuto] = useState(false);
  useEffect(() => { try { setAuto(localStorage.getItem(AI_AUTOSUGGEST_KEY) === "1"); } catch { /* pas de storage */ } }, []);
  const toggleAuto = () => {
    setAuto((v) => {
      const next = !v;
      try { localStorage.setItem(AI_AUTOSUGGEST_KEY, next ? "1" : "0"); } catch { /* pas de storage */ }
      return next;
    });
  };

  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [result, setResult] = useState<ImageAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningFor = useRef<string | null>(null);

  const run = useCallback(async (url: string) => {
    if (runningFor.current === url) return;
    runningFor.current = url;
    setError(null);
    setResult(null);
    setProgress({ phase: "classifying" });
    try {
      const res = await analyzeImage(url, setProgress);
      setResult(res);
    } catch {
      setError("Analyse impossible sur cet appareil.");
    } finally {
      setProgress(null);
      runningFor.current = null;
    }
  }, []);

  // Auto : relance quand l'image change (et efface les résultats de la précédente).
  useEffect(() => {
    setResult(null);
    setError(null);
    if (auto && imageUrl) void run(imageUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // Résout une suggestion (noms) vers les IDs de la taxonomie.
  const resolve = (category: string, subcategory: string): CategorySelection | null => {
    const cat = allCategories.find((c) => c.name === category);
    if (!cat) return null;
    const sub = cat.subcategories.find((s) => s.name === subcategory);
    return { categoryId: cat.id, subcategoryId: sub?.id ?? null };
  };
  const catAdded = (sel: CategorySelection) =>
    currentCategories.some((c) => c.categoryId === sel.categoryId && (c.subcategoryId ?? null) === (sel.subcategoryId ?? null));
  const tagAdded = (name: string) => currentTags.some((t) => t.toLowerCase() === name.toLowerCase());

  const busy = progress !== null;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Sparkles size={14} strokeWidth={2} className="text-[var(--text-secondary)] shrink-0" />
        <span className="text-xs font-medium text-[var(--text-primary)] flex-1">Suggestions IA</span>
        {/* Toggle auto */}
        <button
          type="button"
          onClick={toggleAuto}
          className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          title="Analyser automatiquement chaque image"
        >
          <span
            className={cn(
              "relative w-7 h-4 rounded-full transition-colors",
              auto ? "bg-[var(--text-primary)]" : "bg-[var(--border-default)]",
            )}
          >
            <span className={cn("absolute top-0.5 w-3 h-3 rounded-full bg-[var(--bg-base)] transition-all", auto ? "left-3.5" : "left-0.5")} />
          </span>
          Auto
        </button>
      </div>

      {!result && !busy && (
        <button
          type="button"
          onClick={() => imageUrl && run(imageUrl)}
          disabled={!imageUrl}
          className="w-full py-2 rounded-lg text-xs font-medium bg-[var(--text-primary)] text-[var(--bg-base)] disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          <Sparkles size={13} strokeWidth={2} /> Suggérer catégories &amp; tags
        </button>
      )}

      {busy && (
        <div className="space-y-1.5">
          <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <Loader2 size={12} className="animate-spin" strokeWidth={2.2} />
            {progress?.phase === "downloading"
              ? `Téléchargement du modèle… ${progress.loadedMB ?? 0}/${progress.totalMB ?? "?"} Mo`
              : "Analyse de l'image…"}
          </span>
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-base)]">
            {progress?.phase === "downloading" && progress.totalMB ? (
              <div
                className="h-full rounded-full bg-[var(--text-primary)] transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.round(((progress.loadedMB ?? 0) / progress.totalMB) * 100))}%` }}
              />
            ) : (
              <div className="mb-progress-sweep absolute inset-y-0 left-0 w-1/3 rounded-full bg-[var(--text-primary)]" />
            )}
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {result && !busy && (
        <div className="space-y-2.5">
          {result.categories.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">Catégories</p>
              <div className="flex flex-wrap gap-1.5">
                {result.categories.map((c, i) => {
                  const sel = resolve(c.category, c.subcategory);
                  if (!sel) return null;
                  const added = catAdded(sel);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => !added && onAddCategory(sel)}
                      disabled={added}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-full text-[11px] border transition-colors",
                        added
                          ? "border-[var(--border-subtle)] text-[var(--text-tertiary)] cursor-default"
                          : "border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]",
                      )}
                    >
                      {added ? <Check size={11} strokeWidth={2.5} /> : <Plus size={11} strokeWidth={2.5} />}
                      {c.subcategory} · <span className="text-[var(--text-tertiary)]">{c.category}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {result.tags.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {result.tags.map((t) => {
                  const added = tagAdded(t.label);
                  return (
                    <button
                      key={t.label}
                      type="button"
                      onClick={() => !added && onAddTag(t.label)}
                      disabled={added}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-full text-[11px] border transition-colors",
                        added
                          ? "border-[var(--border-subtle)] text-[var(--text-tertiary)] cursor-default"
                          : "border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]",
                      )}
                    >
                      {added ? <Check size={11} strokeWidth={2.5} /> : <Plus size={11} strokeWidth={2.5} />}
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {result.categories.length === 0 && result.tags.length === 0 && (
            <p className="text-[11px] text-[var(--text-tertiary)]">Pas de suggestion nette pour cette image.</p>
          )}
        </div>
      )}
    </div>
  );
}
