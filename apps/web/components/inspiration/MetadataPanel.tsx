"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { CategoryMultiSelect, type CategorySelection } from "./CategoryMultiSelect";
import { TagInput } from "./TagInput";
import type { Category } from "./CategorySelect";

interface MetadataPanelProps {
  id: string;
  initialData: {
    title: string;
    description: string;
    author: string;
    studio: string;
    year?: number;
    country: string;
    exposition?: string;
    location?: string;
    source?: string;
    notes: string;
    sourceUrl: string;
    categories?: CategorySelection[];
    tags?: string[];
  };
  colorPalette?: { id: string; hex: string; order: number }[];
  aiAnalysis?: { moodDescriptor?: string | null; styleKeywords: string[] } | null;
}

const lbl = "block text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1";
const fld =
  "w-full bg-transparent border-b border-[var(--border-subtle)] focus:border-[var(--border-default)] text-[var(--text-primary)] text-xs py-1 focus:outline-none transition-colors placeholder:text-[var(--text-tertiary)]";

export function MetadataPanel({ id, initialData, colorPalette, aiAnalysis }: MetadataPanelProps) {
  const [data, setData] = useState(initialData);
  const [tags, setTags] = useState<string[]>(initialData.tags ?? []);
  const [categories, setCategories] = useState<CategorySelection[]>(initialData.categories ?? []);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // AI analysis state
  const [aiResult, setAiResult] = useState<{
    moodDescriptor?: string;
    styleKeywords: string[];
    technicalNotes?: string;
    suggestedTitle?: string;
  } | null>(aiAnalysis ? { moodDescriptor: aiAnalysis.moodDescriptor ?? undefined, styleKeywords: aiAnalysis.styleKeywords, technicalNotes: undefined } : null);
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then(setAllCategories)
      .catch(console.error);
  }, []);

  const analyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch(`/api/inspirations/${id}/analyze`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur inconnue");
      setAiResult(json.analysis);
      setPendingTags(json.suggestedTags.filter((t: string) => !tags.includes(t)));
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Erreur d'analyse");
    } finally {
      setAnalyzing(false);
    }
  };

  const acceptTag = (tag: string) => {
    setTags((prev) => [...prev, tag]);
    setPendingTags((prev) => prev.filter((t) => t !== tag));
  };

  const acceptAllTags = () => {
    setTags((prev) => [...prev, ...pendingTags]);
    setPendingTags([]);
  };

  const applySuggestedTitle = () => {
    if (aiResult?.suggestedTitle) update("title", aiResult.suggestedTitle);
  };

  const update = (field: string, value: string | number) =>
    setData((p) => ({ ...p, [field]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/inspirations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          year: data.year || undefined,
          categories,
          tags,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Titre */}
        <div>
          <p className={lbl}>Titre</p>
          <input
            className="w-full bg-transparent text-[var(--text-primary)] text-base font-medium py-0.5 focus:outline-none border-b border-transparent hover:border-[var(--border-subtle)] focus:border-[var(--border-default)] transition-colors"
            value={data.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </div>

        {/* Catégories — multi-sélection */}
        <div>
          <p className={lbl}>Catégories</p>
          <CategoryMultiSelect
            categories={allCategories}
            value={categories}
            onChange={setCategories}
          />
        </div>

        {/* Tags */}
        <div>
          <p className={lbl}>Tags</p>
          <TagInput value={tags} onChange={setTags} placeholder="Entrée pour valider…" />
        </div>

        {/* Description */}
        <div>
          <p className={lbl}>Description</p>
          <textarea className={`${fld} resize-none`} rows={3} value={data.description} onChange={(e) => update("description", e.target.value)} placeholder="—" />
        </div>

        {/* Auteur + Studio */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={lbl}>Auteur</p>
            <input className={fld} value={data.author} onChange={(e) => update("author", e.target.value)} placeholder="—" />
          </div>
          <div>
            <p className={lbl}>Studio</p>
            <input className={fld} value={data.studio} onChange={(e) => update("studio", e.target.value)} placeholder="—" />
          </div>
        </div>

        {/* Année + Pays */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={lbl}>Année</p>
            <input type="number" className={fld} value={data.year ?? ""} onChange={(e) => update("year", parseInt(e.target.value) || 0)} placeholder="—" />
          </div>
          <div>
            <p className={lbl}>Pays</p>
            <input className={fld} value={data.country} onChange={(e) => update("country", e.target.value)} placeholder="—" />
          </div>
        </div>

        {/* Exposition + Lieu */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={lbl}>Exposition</p>
            <input className={fld} value={data.exposition ?? ""} onChange={(e) => update("exposition", e.target.value)} placeholder="—" />
          </div>
          <div>
            <p className={lbl}>Lieu</p>
            <input className={fld} value={data.location ?? ""} onChange={(e) => update("location", e.target.value)} placeholder="—" />
          </div>
        </div>

        <div>
          <p className={lbl}>Source</p>
          <input className={fld} value={data.source ?? ""} onChange={(e) => update("source", e.target.value)} placeholder="—" />
        </div>
        <div>
          <p className={lbl}>URL</p>
          <input type="url" className={fld} value={data.sourceUrl} onChange={(e) => update("sourceUrl", e.target.value)} placeholder="https://" />
        </div>

        <div>
          <p className={lbl}>Notes</p>
          <textarea className={`${fld} resize-none`} rows={3} value={data.notes} onChange={(e) => update("notes", e.target.value)} placeholder="—" />
        </div>

        {/* Palette */}
        {colorPalette && colorPalette.length > 0 && (
          <div>
            <p className={lbl}>Palette</p>
            <div className="flex rounded-md overflow-hidden h-8 mt-1 mb-2">
              {colorPalette.map((c) => (
                <div key={c.id} className="flex-1 relative group cursor-default" style={{ backgroundColor: c.hex }}>
                  <span className="absolute inset-x-0 bottom-0 text-center text-[8px] font-mono pb-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 text-white leading-tight">
                    {c.hex}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {colorPalette.map((c) => (
                <button
                  key={c.id}
                  onClick={() => window.open(`/search?color=${c.hex.replace("#", "")}`, "_blank")}
                  className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-[var(--bg-elevated)] transition-colors group"
                >
                  <div className="w-4 h-4 rounded-sm flex-shrink-0" style={{ backgroundColor: c.hex }} />
                  <span className="text-[9px] font-mono text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors">
                    {c.hex.toUpperCase()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Analyse IA */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className={lbl}>Analyse IA</p>
            <button
              type="button"
              onClick={analyze}
              disabled={analyzing}
              className="text-[9px] text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity disabled:opacity-40 flex items-center gap-1 font-medium"
            >
              {aiResult ? "↺ Re-analyser" : "✦ Analyser avec l'IA"}
            </button>
          </div>

          {analyzing && (
            <div className="flex items-center gap-2 py-3 px-3 rounded-md bg-[var(--bg-elevated)] mb-2">
              <div className="w-3 h-3 rounded-full border-2 border-[var(--accent,#a78bfa)] border-t-transparent animate-spin flex-shrink-0" />
              <span className="text-[10px] text-[var(--text-secondary)]">Gemini analyse l&apos;image…</span>
            </div>
          )}

          {analyzeError && !analyzing && (
            <div className="py-2 px-3 rounded-md bg-red-500/10 mb-2">
              <p className="text-[10px] text-red-400">{analyzeError}</p>
            </div>
          )}

          {!analyzing && aiResult ? (
            <div className="space-y-3">
              {aiResult.moodDescriptor && (
                <p className="text-[11px] text-[var(--text-secondary)] italic leading-relaxed">
                  &ldquo;{aiResult.moodDescriptor}&rdquo;
                </p>
              )}
              {aiResult.technicalNotes && (
                <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
                  {aiResult.technicalNotes}
                </p>
              )}
              {aiResult.styleKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {aiResult.styleKeywords.map((kw) => (
                    <Badge key={kw} variant="ai">{kw}</Badge>
                  ))}
                </div>
              )}
              {aiResult.suggestedTitle && aiResult.suggestedTitle !== data.title && (
                <div className="flex items-center gap-2 p-2 rounded bg-[var(--bg-elevated)]">
                  <span className="text-[10px] text-[var(--text-tertiary)] flex-1 truncate">
                    Titre suggéré : <em className="text-[var(--text-secondary)]">{aiResult.suggestedTitle}</em>
                  </span>
                  <button
                    type="button"
                    onClick={applySuggestedTitle}
                    className="text-[9px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
                  >
                    Appliquer
                  </button>
                </div>
              )}
              {pendingTags.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest">
                      Tags suggérés
                    </p>
                    <button
                      type="button"
                      onClick={acceptAllTags}
                      className="text-[9px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                    >
                      Tout accepter
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {pendingTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => acceptTag(tag)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-dashed border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-colors"
                      >
                        <span>+</span> {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : !analyzing && !analyzeError ? (
            <p className="text-[10px] text-[var(--text-tertiary)]">
              Laisse Gemini analyser l&apos;image pour obtenir des tags, un descripteur d&apos;ambiance et des mots-clés stylistiques.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex-shrink-0 px-6 py-4 border-t border-[var(--border-subtle)]">
        <Button size="sm" onClick={save} loading={saving} className="w-full justify-center">
          {saved ? "Sauvegardé ✓" : "Sauvegarder"}
        </Button>
      </div>
    </div>
  );
}
