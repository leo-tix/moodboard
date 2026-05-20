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

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then(setAllCategories)
      .catch(console.error);
  }, []);

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
        {aiAnalysis && (aiAnalysis.moodDescriptor || aiAnalysis.styleKeywords.length > 0) && (
          <div>
            <p className={lbl}>Analyse IA</p>
            {aiAnalysis.moodDescriptor && (
              <p className="text-[11px] text-[var(--text-secondary)] italic mb-2">&ldquo;{aiAnalysis.moodDescriptor}&rdquo;</p>
            )}
            {aiAnalysis.styleKeywords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {aiAnalysis.styleKeywords.map((kw) => <Badge key={kw} variant="ai">{kw}</Badge>)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-6 py-4 border-t border-[var(--border-subtle)]">
        <Button size="sm" onClick={save} loading={saving} className="w-full justify-center">
          {saved ? "Sauvegardé ✓" : "Sauvegarder"}
        </Button>
      </div>
    </div>
  );
}
