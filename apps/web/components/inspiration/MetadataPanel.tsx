"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { CategoryMultiSelect, type CategorySelection } from "./CategoryMultiSelect";
import { TagInput } from "./TagInput";
import { AutocompleteInput } from "./AutocompleteInput";
import type { Category } from "./CategorySelect";
import { AddToCollectionModal } from "@/components/collections/AddToCollectionModal";
import { VisitPicker, type VisitRef } from "@/components/visits/VisitPicker";

interface MetadataPanelProps {
  id: string;
  initialData: {
    title: string;
    description: string;
    author: string;
    year?: number;
    country: string;
    exposition?: string;
    location?: string;
    source?: string;
    sourceUrl: string;
    categories?: CategorySelection[];
    tags?: string[];
  };
  colorPalette?: { id: string; hex: string; order: number }[];
  aiAnalysis?: { moodDescriptor?: string | null; styleKeywords: string[] } | null;
  /** Collections auxquelles appartient cette inspiration */
  initialCollections?: { id: string; name: string }[];
  /** Visite (musée / expo) à laquelle cette inspiration est rattachée */
  initialVisit?: VisitRef | null;
  /** If true, trigger AI analysis automatically on mount */
  autoAnalyze?: boolean;
  /** If true, render the AI section before the form fields */
  aiFirst?: boolean;
  /**
   * Whether this panel manages its own internal scroll (desktop sidebar,
   * fixed height). On mobile the panel is embedded in a page-level scroll
   * container (bottom-sheet-over-image pattern) — its own overflow-y-auto +
   * overscroll-behavior:contain would swallow the drag and block scroll
   * chaining to the page, so the whole sheet only budged when touching the
   * tiny handle. Pass false there to render as a plain flowing block.
   */
  scrollable?: boolean;
}

const lbl = "block text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1";
const fld =
  "w-full bg-transparent border-b border-[var(--border-subtle)] focus:border-[var(--border-default)] text-[var(--text-primary)] text-xs py-1 focus:outline-none transition-colors placeholder:text-[var(--text-tertiary)]";

export function MetadataPanel({ id, initialData, colorPalette, aiAnalysis, initialCollections, initialVisit, autoAnalyze, aiFirst, scrollable = true }: MetadataPanelProps) {
  const [data, setData] = useState(initialData);
  const [tags, setTags] = useState<string[]>(initialData.tags ?? []);
  const [categories, setCategories] = useState<CategorySelection[]>(initialData.categories ?? []);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // ── Refs — always current, no stale closures in debounce ──
  const dataRef       = useRef(data);        dataRef.current       = data;
  const tagsRef       = useRef(tags);        tagsRef.current       = tags;
  const categoriesRef = useRef(categories);  categoriesRef.current = categories;
  const saveTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Collections ──
  const [myCollections, setMyCollections] = useState<{ id: string; name: string }[]>(
    initialCollections ?? []
  );
  const [showCollectionModal, setShowCollectionModal] = useState(false);

  // ── AI state ──
  const [aiResult, setAiResult] = useState<{
    moodDescriptor?: string;
    styleKeywords: string[];
    technicalNotes?: string;
    suggestedTitle?: string;
  } | null>(aiAnalysis ? { moodDescriptor: aiAnalysis.moodDescriptor ?? undefined, styleKeywords: aiAnalysis.styleKeywords } : null);
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  const [pendingCategories, setPendingCategories] = useState<{ id: string; name: string; icon?: string | null }[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then(setAllCategories)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (autoAnalyze && id) analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, autoAnalyze]);

  // ── Debounced auto-save ──
  const triggerSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(`/api/inspirations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...dataRef.current,
            year: dataRef.current.year || undefined,
            categories: categoriesRef.current,
            tags: tagsRef.current,
          }),
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } finally {
        setSaving(false);
      }
    }, 800);
  }, [id]);

  // ── Field update helpers — all trigger auto-save ──
  const update = useCallback((field: string, value: string | number) => {
    setData((p) => ({ ...p, [field]: value }));
    triggerSave();
  }, [triggerSave]);

  const handleTagsChange = useCallback((newTags: string[]) => {
    setTags(newTags);
    triggerSave();
  }, [triggerSave]);

  const handleCategoriesChange = useCallback((newCats: CategorySelection[]) => {
    setCategories(newCats);
    triggerSave();
  }, [triggerSave]);

  // ── AI ──
  const analyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch(`/api/inspirations/${id}/analyze`, { method: "POST" });
      const text = await res.text();
      if (!text) throw new Error("Réponse vide — timeout probable");
      const json = JSON.parse(text);
      if (!res.ok) throw new Error(json.error ?? `Erreur ${res.status}`);
      setAiResult(json.analysis);
      setPendingTags((json.suggestedTags ?? []).filter((t: string) => !tagsRef.current.includes(t)));
      setPendingCategories(json.suggestedCategories ?? []);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Erreur d'analyse");
    } finally {
      setAnalyzing(false);
    }
  };

  const acceptTag = (tag: string) => {
    const newTags = [...tagsRef.current, tag];
    handleTagsChange(newTags);
    setPendingTags((prev) => prev.filter((t) => t !== tag));
  };

  const acceptAllTags = () => {
    const newTags = [...tagsRef.current, ...pendingTags];
    handleTagsChange(newTags);
    setPendingTags([]);
  };

  const acceptKeywordAsTag = (kw: string) => {
    if (!tagsRef.current.includes(kw)) {
      handleTagsChange([...tagsRef.current, kw]);
    }
  };

  const applySuggestedTitle = () => {
    if (aiResult?.suggestedTitle) update("title", aiResult.suggestedTitle);
  };

  const applyMoodAsDescription = () => {
    if (aiResult?.moodDescriptor) update("description", aiResult.moodDescriptor);
  };

  const acceptCategory = (catId: string) => {
    const newCats = [...categoriesRef.current, { categoryId: catId, subcategoryId: null }];
    handleCategoriesChange(newCats);
    setPendingCategories((prev) => prev.filter((c) => c.id !== catId));
  };

  const acceptAll = () => {
    if (aiResult?.suggestedTitle && aiResult.suggestedTitle !== dataRef.current.title) {
      update("title", aiResult.suggestedTitle);
    }
    if (aiResult?.moodDescriptor && !dataRef.current.description) {
      update("description", aiResult.moodDescriptor);
    }
    acceptAllTags();
    pendingCategories.forEach((cat) => acceptCategory(cat.id));
  };

  const removeFromCollection = async (collectionId: string) => {
    await fetch(`/api/collections/${collectionId}/items`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inspirationIds: [id] }),
    });
    setMyCollections((prev) => prev.filter((c) => c.id !== collectionId));
  };

  // ── AI section ──
  const aiSection = (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className={lbl}>Analyse IA</p>
        <button
          type="button"
          onClick={analyze}
          disabled={analyzing}
          className="text-[9px] text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity disabled:opacity-40 flex items-center gap-1 font-medium"
        >
          {analyzing ? (
            <>
              <div className="w-2.5 h-2.5 rounded-full border-2 border-[var(--accent,#a78bfa)] border-t-transparent animate-spin" />
              Analyse en cours…
            </>
          ) : aiResult ? (
            "↺ Re-analyser"
          ) : (
            "✦ Analyser avec l'IA"
          )}
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
          <button
            type="button"
            onClick={acceptAll}
            className="w-full text-[9px] text-[var(--accent,#a78bfa)] border border-dashed border-[var(--accent,#a78bfa)]/40 hover:border-[var(--accent,#a78bfa)] rounded px-2 py-1.5 transition-colors"
          >
            ✦ Tout accepter
          </button>

          {aiResult.suggestedTitle && aiResult.suggestedTitle !== data.title && (
            <div className="flex items-center gap-2 p-2 rounded bg-[var(--bg-elevated)]">
              <span className="text-[10px] text-[var(--text-tertiary)] flex-1 truncate">
                Titre : <em className="text-[var(--text-secondary)]">{aiResult.suggestedTitle}</em>
              </span>
              <button type="button" onClick={applySuggestedTitle} className="text-[9px] text-[var(--accent,#a78bfa)] hover:opacity-80 flex-shrink-0">
                Appliquer
              </button>
            </div>
          )}

          {aiResult.moodDescriptor && (
            <div className="rounded bg-[var(--bg-elevated)] p-2.5 space-y-1.5">
              <p className="text-[11px] text-[var(--text-secondary)] italic leading-relaxed">
                &ldquo;{aiResult.moodDescriptor}&rdquo;
              </p>
              <button type="button" onClick={applyMoodAsDescription}
                className="text-[9px] text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity">
                → Appliquer comme description
              </button>
            </div>
          )}

          {aiResult.styleKeywords.length > 0 && (
            <div>
              <p className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5">Style — cliquer pour ajouter</p>
              <div className="flex flex-wrap gap-1">
                {aiResult.styleKeywords.map((kw) => {
                  const already = tags.includes(kw);
                  return (
                    <button key={kw} type="button" onClick={() => acceptKeywordAsTag(kw)} disabled={already}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
                        already
                          ? "bg-[var(--bg-overlay)] text-[var(--text-tertiary)] cursor-default"
                          : "border border-[var(--accent,#a78bfa)]/40 text-[var(--accent,#a78bfa)] hover:border-[var(--accent,#a78bfa)]"
                      }`}>
                      {already ? "✓" : "+"} {kw}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {pendingCategories.length > 0 && (
            <div>
              <p className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5">Catégories suggérées</p>
              <div className="flex flex-wrap gap-1">
                {pendingCategories.map((cat) => (
                  <button key={cat.id} type="button" onClick={() => acceptCategory(cat.id)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-dashed border-[var(--accent,#a78bfa)]/40 text-[var(--accent,#a78bfa)] hover:border-[var(--accent,#a78bfa)] transition-colors">
                    + {cat.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {pendingTags.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest">Tags suggérés</p>
                <button type="button" onClick={acceptAllTags}
                  className="text-[9px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
                  Tout accepter
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {pendingTags.map((tag) => (
                  <button key={tag} type="button" onClick={() => acceptTag(tag)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-dashed border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
                    + {tag}
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
  );

  // ── Form fields ──
  const formFields = (
    <>
      <div>
        <p className={lbl}>Titre</p>
        <AutocompleteInput
          field="title"
          value={data.title}
          onChange={(v) => update("title", v)}
          inputClassName="w-full bg-transparent text-[var(--text-primary)] text-base font-medium py-0.5 focus:outline-none border-b border-transparent hover:border-[var(--border-subtle)] focus:border-[var(--border-default)] transition-colors"
        />
      </div>

      <div>
        <p className={lbl}>Catégories</p>
        <CategoryMultiSelect
          categories={allCategories}
          value={categories}
          onChange={handleCategoriesChange}
        />
      </div>

      <div>
        <p className={lbl}>Tags</p>
        <TagInput value={tags} onChange={handleTagsChange} placeholder="Entrée pour valider…" withSuggestions />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <p className={lbl}>Collections</p>
          <button
            type="button"
            onClick={() => setShowCollectionModal(true)}
            className="text-[11px] md:text-[9px] py-1.5 md:py-0 px-1 text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity"
          >
            + Ajouter
          </button>
        </div>
        {myCollections.length === 0 ? (
          <p className="text-[10px] text-[var(--text-tertiary)]">—</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {myCollections.map((col) => (
              <span key={col.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                {col.name}
                <button
                  type="button"
                  onClick={() => removeFromCollection(col.id)}
                  className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity leading-none"
                  title="Retirer de cette collection"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <VisitPicker inspirationId={id} initialVisit={initialVisit} />

      <div>
        <p className={lbl}>Description</p>
        <textarea className={`${fld} resize-none`} rows={3} value={data.description} onChange={(e) => update("description", e.target.value)} placeholder="—" />
      </div>

      <div>
        <p className={lbl}>Auteur</p>
        <AutocompleteInput field="author" value={data.author} onChange={(v) => update("author", v)} placeholder="—" inputClassName={fld} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className={lbl}>Année</p>
          <AutocompleteInput field="year" type="number" value={data.year ? String(data.year) : ""} onChange={(v) => update("year", parseInt(v) || 0)} placeholder="—" inputClassName={fld} />
        </div>
        <div>
          <p className={lbl}>Pays</p>
          <input className={fld} value={data.country} onChange={(e) => update("country", e.target.value)} placeholder="—" />
        </div>
      </div>

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
    </>
  );

  return (
    <div className={scrollable ? "flex flex-col h-full" : ""}>
      <div
        className={scrollable ? "flex-1 overflow-y-auto p-6 space-y-5" : "p-6 space-y-5"}
        style={scrollable ? { overscrollBehaviorY: "contain" } : undefined}
      >
        {aiFirst ? (
          <>
            {aiSection}
            <hr className="border-[var(--border-subtle)]" />
            {formFields}
          </>
        ) : (
          <>
            {formFields}
            {aiSection}
          </>
        )}
      </div>

      {/* Status bar — minimal, no button */}
      <div className="flex-shrink-0 px-6 py-2 border-t border-[var(--border-subtle)] flex items-center justify-end min-h-[36px]">
        {saving && (
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
            <div className="w-2.5 h-2.5 rounded-full border border-current border-t-transparent animate-spin" />
            Sauvegarde…
          </div>
        )}
        {!saving && saved && (
          <span className="text-[10px] text-[var(--text-tertiary)]">Sauvegardé ✓</span>
        )}
      </div>

      {showCollectionModal && (
        <AddToCollectionModal
          inspirationIds={[id]}
          onClose={() => setShowCollectionModal(false)}
          onAdded={(collectionId, collectionName) => {
            setMyCollections((prev) =>
              prev.find((c) => c.id === collectionId)
                ? prev
                : [...prev, { id: collectionId, name: collectionName }]
            );
          }}
        />
      )}
    </div>
  );
}
