"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Check, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Category } from "@/components/inspiration/CategorySelect";
import type { CategorySelection } from "@/components/inspiration/CategoryMultiSelect";

type AiStatus = "PENDING" | "PROCESSING" | "DONE" | "ERROR";
interface SuggestedTag { label: string; score: number; z: number; group: string }
interface SuggestedCategory { categoryId: string; subcategoryId: string | null; score: number; z: number }

interface Props {
  /** Id de l'inspiration — sert à interroger ses suggestions IA (poll tant
   * que l'analyse n'est pas DONE, voir le worker `apps/ai-worker`). */
  id: string;
  allCategories: Category[];
  currentCategories: CategorySelection[];
  currentTags: string[];
  onAddCategory: (sel: CategorySelection) => void;
  /** `fromAi` indique au parent qu'il doit tracer ce tag comme
   * `aiTagNames` dans le prochain PATCH, pour poser `Tag.source = AI`. */
  onAddTag: (name: string, fromAi: boolean) => void;
}

const POLL_MS = 4000;

// Panneau de suggestions IA — tags/catégories calculés en continu côté VPS
// (apps/ai-worker, voir le plan), jamais côté navigateur. Purement passif :
// affiche ce que le worker a déjà produit, l'utilisateur clique ce qu'il
// garde, rien n'est appliqué d'office.
export function AiSuggestPanel({ id, allCategories, currentCategories, currentTags, onAddCategory, onAddTag }: Props) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [tags, setTags] = useState<SuggestedTag[]>([]);
  const [categories, setCategories] = useState<SuggestedCategory[]>([]);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stopped = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/inspirations/${id}/ai-suggestions`);
        if (!res.ok) return;
        const data = await res.json();
        if (stopped) return;
        setStatus(data.aiStatus);
        setTags(Array.isArray(data.aiSuggestedTags) ? data.aiSuggestedTags : []);
        setCategories(Array.isArray(data.aiSuggestedCategories) ? data.aiSuggestedCategories : []);
        if (data.aiStatus === "PENDING" || data.aiStatus === "PROCESSING") {
          pollTimer.current = setTimeout(poll, POLL_MS);
        }
      } catch {
        // silencieux — on retentera au prochain montage, pas de bruit pour l'utilisateur
      }
    };
    poll();

    return () => {
      stopped = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [id]);

  const resolveCategory = (categoryId: string, subcategoryId: string | null) => {
    const cat = allCategories.find((c) => c.id === categoryId);
    if (!cat) return null;
    const sub = subcategoryId ? cat.subcategories.find((s) => s.id === subcategoryId) : undefined;
    return { cat, sub };
  };
  const catAdded = (sel: CategorySelection) =>
    currentCategories.some((c) => c.categoryId === sel.categoryId && (c.subcategoryId ?? null) === (sel.subcategoryId ?? null));
  const tagAdded = (name: string) => currentTags.some((t) => t.toLowerCase() === name.toLowerCase());

  const chip = (added: boolean, onClick: () => void, key: string, children: React.ReactNode) => (
    <button
      key={key}
      type="button"
      onClick={() => !added && onClick()}
      disabled={added}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-full text-[11px] border transition-colors",
        added
          ? "border-[var(--border-subtle)] text-[var(--text-tertiary)] cursor-default"
          : "border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]",
      )}
    >
      {added ? <Check size={11} strokeWidth={2.5} /> : <Plus size={11} strokeWidth={2.5} />}
      {children}
    </button>
  );

  const waiting = status === "PENDING" || status === "PROCESSING";
  const hasSuggestions = tags.length > 0 || categories.length > 0;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Sparkles size={14} strokeWidth={2} className="text-[var(--text-secondary)] shrink-0" />
        <span className="text-xs font-medium text-[var(--text-primary)] flex-1">Suggestions IA</span>
      </div>

      {waiting && (
        <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Loader2 size={12} className="animate-spin" strokeWidth={2.2} />
          En attente d&apos;analyse…
        </span>
      )}

      {status === "ERROR" && (
        <p className="text-[11px] text-[var(--text-tertiary)]">Analyse impossible pour cette image.</p>
      )}

      {status === "DONE" && (
        <div className="space-y-2.5">
          {categories.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">Catégories</p>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c, i) => {
                  const resolved = resolveCategory(c.categoryId, c.subcategoryId);
                  if (!resolved) return null;
                  const sel: CategorySelection = { categoryId: c.categoryId, subcategoryId: c.subcategoryId };
                  return chip(catAdded(sel), () => onAddCategory(sel), `cat-${i}`, (
                    <>{resolved.sub?.name ?? resolved.cat.name} <span className="text-[var(--text-tertiary)]">· {resolved.cat.name}</span></>
                  ));
                })}
              </div>
            </div>
          )}
          {tags.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => chip(tagAdded(t.label), () => onAddTag(t.label, true), t.label, t.label))}
              </div>
            </div>
          )}
          {!hasSuggestions && (
            <p className="text-[11px] text-[var(--text-tertiary)]">Pas de suggestion nette pour cette image.</p>
          )}
        </div>
      )}
    </div>
  );
}
