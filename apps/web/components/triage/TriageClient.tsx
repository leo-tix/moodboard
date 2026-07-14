"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { X, Check, ArrowUp, CircleSlash, RotateCcw, Copy, Maximize2, PartyPopper } from "lucide-react";
import { getThumbnailUrl, getImageUrl } from "@/lib/storage/urls";
import { CategoryMultiSelect, type CategorySelection } from "@/components/inspiration/CategoryMultiSelect";
import { TagInput } from "@/components/inspiration/TagInput";
import { AutocompleteInput } from "@/components/inspiration/AutocompleteInput";
import type { Category } from "@/components/inspiration/CategorySelect";
import { notifyTriageCountChanged } from "@/lib/triage/events";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TriageItem {
  id:          string;
  title:       string;
  author:      string | null;
  year:        number | null;
  description: string | null;
  sourceUrl:   string | null;
  categories:  { categoryId: string; subcategoryId: string | null }[];
  tags:        { tag: { name: string } }[];
  images:      { storageKey: string; thumbnailKey: string | null; width: number | null; height: number | null }[];
}

interface LocalFields {
  title:      string;
  author:     string;
  year:       string;
  categories: CategorySelection[];
  tags:       string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SWIPE_THRESHOLD = 80;
const SWIPE_EXIT_X   = 650;
const SWIPE_EXIT_Y   = -350;

function itemToLocal(item: TriageItem): LocalFields {
  return {
    title:      item.title,
    author:     item.author ?? "",
    year:       item.year ? String(item.year) : "",
    categories: item.categories.map((c) => ({
      categoryId:    c.categoryId,
      subcategoryId: c.subcategoryId ?? null,
    })),
    tags: item.tags.map((t) => t.tag.name),
  };
}

const fld = "w-full bg-transparent border-b border-[var(--border-subtle)] focus:border-[var(--border-default)] text-[var(--text-primary)] text-xs py-1.5 focus:outline-none transition-colors placeholder:text-[var(--text-tertiary)]";
const lbl = "block text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5";

// ── Bottom sheet (mobile metadata drawer) ────────────────────────────────────
// Vrai geste de fermeture par glissement (pattern iOS/Instagram) : le drag ne
// fonctionnait qu'en tapant précisément la croix ✕, ce qui donnait l'impression
// que la fiche était "bloquée". La poignée + l'en-tête sont maintenant une zone
// de drag réelle — la feuille suit le doigt et se ferme au-delà d'un seuil,
// sinon revient avec un effet ressort. Le contenu (formulaire) garde son propre
// scroll interne, indépendant du geste de fermeture.

function BottomSheet({
  open, onClose, children, backdrop,
}: { open: boolean; onClose: () => void; children: React.ReactNode; backdrop?: React.ReactNode }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const draggingRef = useRef(false);
  const currentY = useRef(0);

  // Verrouiller le scroll du body pendant que la feuille est ouverte
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Efface une transform/transition inline résiduelle d'un drag précédent
  // (glissement relâché en "snap back", ou fermeture par glissement) à
  // l'ouverture — sinon elle prime sur la classe Tailwind translate-y-0/
  // full et empêche l'animation de glissement d'apparaître (bug remonté :
  // "la popup ne slide pas"). Avant : on FORÇAIT `transform: translateY(0)`
  // + `transition: none`, ce qui figeait la feuille en place instantanément
  // même au tout premier affichage, sans jamais laisser la transition CSS
  // s'exécuter. useLayoutEffect (avant peinture) pour éviter tout flash de
  // l'ancienne position.
  useLayoutEffect(() => {
    if (open && sheetRef.current) {
      sheetRef.current.style.transition = "";
      sheetRef.current.style.transform = "";
      currentY.current = 0;
    }
    if (open && backdropRef.current) {
      backdropRef.current.style.opacity = "";
    }
  }, [open]);

  const onDragStart = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    dragStartY.current = e.clientY;
    if (sheetRef.current) sheetRef.current.style.transition = "none";
  };

  const onDragMove = (e: React.PointerEvent) => {
    if (!draggingRef.current || !sheetRef.current) return;
    const dy = Math.max(0, e.clientY - dragStartY.current); // ne monte pas au-dessus de l'ancre
    currentY.current = dy;
    sheetRef.current.style.transform = `translateY(${dy}px)`;
    if (backdropRef.current) {
      backdropRef.current.style.opacity = String(Math.max(0.15, 1 - dy / 300));
    }
  };

  const onDragEnd = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (!sheetRef.current) return;
    sheetRef.current.style.transition = "transform 0.25s cubic-bezier(0.2,0,0,1)";
    if (currentY.current > 100) {
      sheetRef.current.style.transform = "translateY(100%)";
      if (backdropRef.current) backdropRef.current.style.opacity = "0";
      setTimeout(onClose, 200);
    } else {
      sheetRef.current.style.transform = "translateY(0)";
      if (backdropRef.current) backdropRef.current.style.opacity = "1";
    }
  };

  return (
    <>
      {/* Backdrop — image plein écran quand fourni (mode "expanded"), sinon voile noir classique */}
      {open && (
        <div
          ref={backdropRef}
          className="fixed inset-0 z-40 md:hidden"
          onClick={onClose}
        >
          {backdrop ?? <div className="absolute inset-0 bg-black/40" />}
        </div>
      )}
      {/* Sheet — touch-action:none scoped à la seule zone de drag (poignée/en-tête) ;
          le mettre sur tout le conteneur bloquerait aussi le scroll natif du
          contenu en dessous (touch-action d'un ancêtre restreint ses descendants). */}
      <div
        ref={sheetRef}
        className={`fixed inset-x-0 bottom-0 z-50 md:hidden transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ maxHeight: "80vh" }}
      >
        <div className="bg-[var(--bg-elevated)] rounded-t-2xl border-t border-[var(--border-default)] flex flex-col overflow-hidden"
             style={{ maxHeight: "80vh" }}>
          {/* Handle + header — zone de drag pour fermer */}
          <div
            className="flex-shrink-0 relative"
            style={{ touchAction: "none" }}
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <div className="flex justify-center pt-2.5 pb-1.5 cursor-grab active:cursor-grabbing">
              <div className="w-10 h-1.5 bg-[var(--border-default)] rounded-full" />
            </div>
            <div className="flex items-center justify-between px-5 pb-3 border-b border-[var(--border-subtle)]">
              <p className="text-sm font-medium text-[var(--text-primary)]">Métadonnées</p>
              <button
                onClick={onClose}
                className="w-9 h-9 -mr-2 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors text-sm"
                aria-label="Fermer"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
          <div
            className="flex-1 overflow-y-auto p-5 space-y-4"
            style={{ overscrollBehavior: "contain", touchAction: "pan-y" }}
          >
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TriageClient() {
  const [queue,         setQueue]         = useState<TriageItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [fields,        setFields]        = useState<LocalFields | null>(null);
  const [prevFields,    setPrevFields]    = useState<LocalFields | null>(null);
  const [saveStatus,    setSaveStatus]    = useState<"idle" | "saving" | "saved">("idle");
  const [hint,          setHint]          = useState<"left" | "right" | "up" | null>(null);
  const [isExiting,     setIsExiting]     = useState(false);
  const [metaOpen,      setMetaOpen]      = useState(false);
  // Vue étendue : image plein écran + fiche métadonnées éditable simultanément
  const [expandedView,  setExpandedView]  = useState(false);
  // Rewind (Tinder) — annule la dernière décision accept/archive
  const [lastAction, setLastAction] = useState<{
    item: TriageItem; fields: LocalFields; action: "accept" | "archive";
  } | null>(null);
  const [undoing, setUndoing] = useState(false);

  const fieldsRef   = useRef<LocalFields | null>(null);
  fieldsRef.current = fields;

  const cardRef   = useRef<HTMLDivElement>(null);
  const behindRef = useRef<HTMLDivElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null); // for bg color shift

  const isDraggingRef = useRef(false);
  const dragStartX    = useRef(0);
  const dragStartY    = useRef(0);
  const dragXRef      = useRef(0);
  const dragYRef      = useRef(0);
  const movedRef      = useRef(false); // distingue tap (preview) de drag (swipe)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch ──

  useEffect(() => {
    Promise.all([
      fetch("/api/triage").then((r) => r.json()),
      fetch("/api/categories").then((r) => r.json()),
    ]).then(([triageData, cats]) => {
      const items: TriageItem[] = triageData.items ?? [];
      setQueue(items);
      if (items.length > 0) setFields(itemToLocal(items[0]));
      setAllCategories(cats);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const current = queue[0] ?? null;

  useEffect(() => {
    if (current) setFields(itemToLocal(current));
    if (cardRef.current) {
      cardRef.current.style.transition = "none";
      cardRef.current.style.transform  = "translateX(0) translateY(0) rotate(0deg) scale(1)";
      cardRef.current.style.opacity    = "1";
      cardRef.current.style.boxShadow  = "";
    }
    if (behindRef.current) {
      behindRef.current.style.transform = "scale(0.94) translateY(10px)";
      behindRef.current.style.opacity   = "0.55";
    }
    clearBg();
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Background color reaction ──

  const clearBg = () => {
    if (wrapRef.current) wrapRef.current.style.backgroundColor = "";
  };

  const updateBg = (dx: number, dy: number) => {
    if (!wrapRef.current) return;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    const intensity = Math.min(Math.max(Math.max(absX, absY) / 200, 0), 0.12);
    if (absY > absX && dy < 0) {
      wrapRef.current.style.backgroundColor = `rgba(59,130,246,${intensity})`;
    } else if (dx > 0) {
      wrapRef.current.style.backgroundColor = `rgba(34,197,94,${intensity})`;
    } else if (dx < 0) {
      wrapRef.current.style.backgroundColor = `rgba(239,68,68,${intensity})`;
    } else {
      clearBg();
    }
  };

  // ── Auto-save ──

  const triggerSave = useCallback(() => {
    if (!current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const f = fieldsRef.current;
      if (!f) return;
      setSaveStatus("saving");
      await fetch(`/api/inspirations/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: f.title, author: f.author || undefined,
          year: parseInt(f.year) || undefined, categories: f.categories, tags: f.tags,
        }),
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }, 800);
  }, [current]);

  const updateField = <K extends keyof LocalFields>(key: K, value: LocalFields[K]) => {
    setFields((prev) => prev ? { ...prev, [key]: value } : prev);
    triggerSave();
  };

  // ── Haptic ──

  const vibrate = (pattern: number | number[]) => {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(pattern);
  };

  // ── Actions ──

  const doAction = useCallback(async (action: "accept" | "archive" | "skip") => {
    if (!current) return;

    if (action === "skip") {
      vibrate(10);
      setQueue((q) => [...q.slice(1), q[0]]);
      setIsExiting(false);
      setHint(null);
      clearBg();
      return;
    }

    vibrate(action === "accept" ? [10, 30, 60] : [60]);

    if (saveTimer.current) clearTimeout(saveTimer.current);
    const f = fieldsRef.current;
    if (f) {
      await fetch(`/api/inspirations/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: f.title, author: f.author || undefined,
          year: parseInt(f.year) || undefined, categories: f.categories, tags: f.tags,
        }),
      });
      setPrevFields({ ...f });
      // Mémorise pour le rewind — capture item + champs AVANT de faire avancer la queue
      setLastAction({ item: current, fields: { ...f }, action });
    }

    await fetch(`/api/triage/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    // accept/archive change le compte d'images en attente de triage — prévient
    // la pastille (BottomNav/Sidebar) pour qu'elle se mette à jour tout de
    // suite, sans attendre un remount ou un focus d'onglet.
    notifyTriageCountChanged();

    setQueue((q) => q.slice(1));
    setIsExiting(false);
    setHint(null);
    clearBg();
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Undo (rewind) — Tinder-style : remet la dernière décision en tête de file ──

  const undo = useCallback(async () => {
    if (!lastAction || undoing) return;
    setUndoing(true);
    vibrate(20);
    try {
      await fetch(`/api/triage/${lastAction.item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo" }),
      });
      notifyTriageCountChanged();
      setQueue((q) => [lastAction.item, ...q]);
      setFields(lastAction.fields);
      setLastAction(null);
    } finally {
      setUndoing(false);
    }
  }, [lastAction, undoing]);

  // ── Exit animation ──

  const animateExit = useCallback((direction: "left" | "right" | "up", onDone: () => void) => {
    const card = cardRef.current;
    if (!card) { onDone(); return; }

    setIsExiting(true);
    setHint(null);

    card.style.transition = "transform 0.32s cubic-bezier(0.55,0,1,0.45), opacity 0.32s ease";
    if (direction === "up") {
      card.style.transform = `translateY(${SWIPE_EXIT_Y}px) scale(0.8)`;
    } else {
      const exitX = direction === "right" ? SWIPE_EXIT_X : -SWIPE_EXIT_X;
      const rot   = direction === "right" ? 20 : -20;
      card.style.transform = `translateX(${exitX}px) rotate(${rot}deg) scale(0.9)`;
    }
    card.style.opacity = "0";

    if (behindRef.current) {
      behindRef.current.style.transition = "transform 0.32s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease";
      behindRef.current.style.transform  = "scale(1) translateY(0)";
      behindRef.current.style.opacity    = "1";
    }

    setTimeout(onDone, 330);
  }, []);

  // ── Pointer events ──

  const onPointerDown = (e: React.PointerEvent) => {
    if (isExiting) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStartX.current = e.clientX;
    dragStartY.current = e.clientY;
    dragXRef.current   = 0;
    dragYRef.current   = 0;
    movedRef.current   = false;
    isDraggingRef.current = true;
    if (cardRef.current) {
      cardRef.current.style.transition = "none";
      cardRef.current.style.cursor     = "grabbing";
      // Press scale
      cardRef.current.style.transform  = "scale(0.98)";
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current || !cardRef.current) return;
    const dx = e.clientX - dragStartX.current;
    const dy = e.clientY - dragStartY.current;
    dragXRef.current = dx;
    dragYRef.current = dy;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) movedRef.current = true;

    const rot  = dx * 0.05;
    const lift = Math.min(Math.abs(dx) + Math.abs(dy), 120);
    const shadow = `0 ${8 + lift * 0.4}px ${24 + lift}px rgba(0,0,0,${0.15 + lift * 0.002})`;

    cardRef.current.style.transform  = `translateX(${dx}px) translateY(${dy}px) rotate(${rot}deg) scale(1)`;
    cardRef.current.style.boxShadow  = shadow;

    updateBg(dx, dy);

    const absX = Math.abs(dx), absY = Math.abs(dy);
    const newHint: typeof hint =
      absY > absX && dy < -25 ? "up"    :
      dx > 25                 ? "right" :
      dx < -25                ? "left"  : null;
    setHint((h) => h !== newHint ? newHint : h);
  };

  const onPointerUp = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (cardRef.current) cardRef.current.style.cursor = "grab";

    const dx = dragXRef.current;
    const dy = dragYRef.current;
    const absX = Math.abs(dx), absY = Math.abs(dy);

    if (absY > absX && dy < -SWIPE_THRESHOLD) {
      animateExit("up", () => doAction("skip"));
    } else if (dx > SWIPE_THRESHOLD) {
      animateExit("right", () => doAction("accept"));
    } else if (dx < -SWIPE_THRESHOLD) {
      animateExit("left", () => doAction("archive"));
    } else {
      setHint(null);
      clearBg();
      if (cardRef.current) {
        cardRef.current.style.transition = "transform 0.4s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s ease";
        cardRef.current.style.transform  = "translateX(0) translateY(0) rotate(0deg) scale(1)";
        cardRef.current.style.boxShadow  = "";
      }
      // Tap sans déplacement (ni drag ni swipe) → image plein écran + édition
      // des métadonnées en simultané (pattern Pinterest/Instagram : le tap
      // inspecte/édite, le swipe décide)
      if (!movedRef.current) setExpandedView(true);
    }
  };

  // ── Keyboard ──

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      if (isExiting) return;
      if (e.key === "ArrowLeft")  animateExit("left",  () => doAction("archive"));
      if (e.key === "ArrowRight") animateExit("right", () => doAction("accept"));
      if (e.key === "ArrowUp")    animateExit("up",    () => doAction("skip"));
      if (e.key === "z" || e.key === "Z") undo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [animateExit, doAction, isExiting, undo]);

  // ── Copy previous ──

  const copyPrevious = () => {
    if (!prevFields) return;
    vibrate(15);
    setFields((prev) => prev ? { ...prev, ...prevFields } : prev);
    triggerSave();
  };

  // ── Metadata fields (shared between desktop panel + mobile sheet) ──

  const metadataFields = fields && (
    <div className="space-y-4">
      <div>
        <p className={lbl}>Titre</p>
        <AutocompleteInput
          field="title"
          value={fields.title}
          onChange={(v) => updateField("title", v)}
          inputClassName="w-full bg-transparent text-[var(--text-primary)] text-sm font-medium py-0.5 focus:outline-none border-b border-transparent hover:border-[var(--border-subtle)] focus:border-[var(--border-default)] transition-colors"
        />
      </div>
      <div>
        <p className={lbl}>Catégories</p>
        <CategoryMultiSelect categories={allCategories} value={fields.categories} onChange={(v) => updateField("categories", v)} />
      </div>
      <div>
        <p className={lbl}>Tags</p>
        <TagInput value={fields.tags} onChange={(v) => updateField("tags", v)} placeholder="Entrée pour valider…" withSuggestions />
      </div>
      <div>
        <p className={lbl}>Auteur</p>
        <AutocompleteInput field="author" value={fields.author} onChange={(v) => updateField("author", v)} placeholder="—" inputClassName={fld} />
      </div>
      <div>
        <p className={lbl}>Année</p>
        <AutocompleteInput field="year" type="number" value={fields.year} onChange={(v) => updateField("year", v)} placeholder="—" inputClassName={fld} />
      </div>
    </div>
  );

  // ── Empty state ──

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--accent,#a78bfa)] border-t-transparent animate-spin" />
          <p className="text-sm text-[var(--text-tertiary)]">Chargement…</p>
        </div>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-6 text-center px-8">
        <div className="animate-bounce text-[var(--text-primary)]"><PartyPopper size={56} strokeWidth={1.5} /></div>
        <div>
          <p className="text-2xl font-medium text-[var(--text-primary)]">Tout est trié !</p>
          <p className="text-sm text-[var(--text-tertiary)] mt-2">
            Ta bibliothèque est à jour.
          </p>
        </div>
        <Link href="/library"
          className="px-6 py-3 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-xl text-sm font-medium hover:opacity-90 transition-opacity">
          Voir la bibliothèque →
        </Link>
        <a href="/search?archived=true"
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
          ⊘ Voir les archives
        </a>
        {lastAction && (
          <button
            onClick={undo}
            disabled={undoing}
            className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-40"
          >
            ↺ Annuler la dernière décision
          </button>
        )}
      </div>
    );
  }

  const img  = current?.images[0];
  const next = queue[1];
  const total = queue.length;

  // Hint colors
  const hintBg =
    hint === "right" ? "bg-green-500/10" :
    hint === "left"  ? "bg-red-500/10"   :
    hint === "up"    ? "bg-blue-500/10"  : "";

  return (
    <div
      ref={wrapRef}
      className={`flex flex-col h-screen transition-colors duration-100 ${hintBg}`}
      style={{ overscrollBehavior: "none" }}
    >
      {/* ── Top bar ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-1.5 min-w-0">
          <Link
            href="/library"
            className="w-9 h-9 sm:w-auto sm:h-auto flex items-center justify-center text-sm sm:text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0"
          >
            ←
          </Link>
          {/* Progress dots (max 7) */}
          <div className="flex items-center gap-1 ml-0.5 flex-shrink-0">
            {Array.from({ length: Math.min(total, 7) }).map((_, i) => (
              <div
                key={i}
                className={`rounded-full transition-all duration-300 ${
                  i === 0 ? "w-2 h-2 bg-[var(--text-primary)]" : "w-1.5 h-1.5 bg-[var(--border-default)]"
                }`}
              />
            ))}
            {total > 7 && <span className="text-[10px] text-[var(--text-tertiary)] ml-0.5">+{total - 7}</span>}
          </div>
          <span className="text-[10px] text-[var(--text-tertiary)] ml-1 truncate">{total} restante{total > 1 ? "s" : ""}</span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <a href="/search?archived=true"
            className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors border border-[var(--border-subtle)] px-2 py-1 rounded-lg hidden sm:flex items-center gap-1">
            <CircleSlash size={11} strokeWidth={1.75} /> Archives
          </a>
          {/* Rewind (Tinder) — annule la dernière décision accept/archive */}
          <button
            onClick={undo}
            disabled={!lastAction || undoing}
            title="Annuler la dernière décision (z)"
            className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-25 disabled:hover:text-[var(--text-secondary)] transition-colors border border-[var(--border-subtle)] rounded-lg flex-shrink-0"
          >
            <RotateCcw size={15} strokeWidth={1.75} />
          </button>
          <button
            onClick={() => !isExiting && animateExit("up", () => doAction("skip"))}
            className="h-9 sm:h-auto flex items-center text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors border border-[var(--border-subtle)] px-3 sm:py-1.5 rounded-lg flex-shrink-0"
            title="Passer (↑)"
          >
            <span className="inline-flex items-center gap-1">Passer <ArrowUp size={13} strokeWidth={1.75} /></span>
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── Card area ── */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4 min-w-0 min-h-0">

          {/* Card stack */}
          <div className="relative w-full" style={{ maxWidth: "min(100%, 380px)" }}>

            {/* Card behind */}
            {next && (
              <div
                ref={behindRef}
                className="absolute inset-0 rounded-2xl overflow-hidden bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
                style={{ zIndex: 0, transform: "scale(0.94) translateY(10px)", opacity: 0.55 }}
              >
                {next.images[0] && (
                  <img
                    src={getThumbnailUrl(next.images[0].thumbnailKey ?? next.images[0].storageKey)}
                    alt=""
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                )}
              </div>
            )}

            {/* Current card */}
            <div
              ref={cardRef}
              className="rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-surface)] touch-none relative"
              style={{
                zIndex: 1,
                cursor: "grab",
                boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* Image — max height to leave room for buttons */}
              <div
                className="relative w-full"
                style={{ maxHeight: "52vh", overflow: "hidden" }}
              >
                {img ? (
                  <img
                    src={getThumbnailUrl(img.thumbnailKey ?? img.storageKey)}
                    alt={current?.title}
                    draggable={false}
                    className="w-full object-cover block"
                    style={{ maxHeight: "52vh" }}
                  />
                ) : (
                  <div className="h-48 bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-tertiary)] text-xs">
                    Aucune image
                  </div>
                )}

                {/* Hint overlays */}
                {hint === "right" && (
                  <div className="absolute inset-0 bg-gradient-to-l from-green-500/30 to-transparent flex items-center justify-end pr-6 pointer-events-none">
                    <span className="text-green-400 drop-shadow-lg rotate-[-12deg] border-4 border-green-400 rounded-2xl p-2"><Check size={40} strokeWidth={3} /></span>
                  </div>
                )}
                {hint === "left" && (
                  <div className="absolute inset-0 bg-gradient-to-r from-red-500/30 to-transparent flex items-center justify-start pl-6 pointer-events-none">
                    <span className="text-red-400 drop-shadow-lg rotate-[12deg] border-4 border-red-400 rounded-2xl p-2"><X size={40} strokeWidth={3} /></span>
                  </div>
                )}
                {hint === "up" && (
                  <div className="absolute inset-0 bg-gradient-to-b from-blue-500/30 to-transparent flex items-start justify-center pt-4 pointer-events-none">
                    <span className="text-blue-400 drop-shadow-lg border-4 border-blue-400 rounded-2xl p-2"><ArrowUp size={40} strokeWidth={3} /></span>
                  </div>
                )}
              </div>

              {/* Title overlay at bottom of card */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-4 py-3 pointer-events-none">
                <p className="text-white text-sm font-medium truncate drop-shadow">{current?.title}</p>
                {fields?.categories && fields.categories.length > 0 && (
                  <p className="text-white/60 text-[10px] truncate mt-0.5">
                    {fields.categories.length} catégorie{fields.categories.length > 1 ? "s" : ""}
                    {fields.tags.length > 0 && ` · ${fields.tags.length} tag${fields.tags.length > 1 ? "s" : ""}`}
                  </p>
                )}
              </div>

              {/* Save indicator */}
              <div className="absolute top-2 right-2 pointer-events-none">
                {saveStatus === "saving" && (
                  <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                )}
                {saveStatus === "saved" && (
                  <span className="text-white bg-black/50 p-1 rounded-full flex"><Check size={11} strokeWidth={3} /></span>
                )}
              </div>

              {/* Affordance — tap pour voir en plein écran (Pinterest/Instagram) */}
              <div className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                <Maximize2 size={12} strokeWidth={1.6} className="text-white/85" />
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 w-full" style={{ maxWidth: "min(100%, 380px)" }}>
            {/* Archive */}
            <button
              onClick={() => !isExiting && animateExit("left", () => doAction("archive"))}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-red-500/40 text-red-400 hover:bg-red-500/10 active:scale-95 transition-all text-sm font-semibold"
              title="Archiver ← (touche ←)"
            >
              <X size={18} strokeWidth={2} />
              <span className="hidden sm:inline">Archiver</span>
            </button>

            {/* Copy prev */}
            <button
              onClick={copyPrevious}
              disabled={!prevFields}
              className="w-14 h-14 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] active:scale-95 disabled:opacity-25 transition-all flex-shrink-0"
              title="Copier les données de l'image précédente"
            >
              <Copy size={18} strokeWidth={1.5} />
            </button>

            {/* Accept */}
            <button
              onClick={() => !isExiting && animateExit("right", () => doAction("accept"))}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-green-500/40 text-green-400 hover:bg-green-500/10 active:scale-95 transition-all text-sm font-semibold"
              title="Accepter → (touche →)"
            >
              <span className="hidden sm:inline">Accepter</span>
              <Check size={18} strokeWidth={2} />
            </button>
          </div>

          {/* Mobile: edit metadata button */}
          <button
            onClick={() => setMetaOpen(true)}
            className="md:hidden flex items-center gap-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors border border-[var(--border-subtle)] px-4 py-2 rounded-xl"
          >
            ✎ Métadonnées
            {fields && (fields.categories.length > 0 || fields.tags.length > 0) && (
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent,#a78bfa)] flex-shrink-0" />
            )}
          </button>

          {/* Desktop keyboard hint */}
          <p className="text-[9px] text-[var(--text-tertiary)] text-center hidden md:block">
            ← Archiver &nbsp;·&nbsp; ↑ Passer &nbsp;·&nbsp; → Accepter
          </p>
        </div>

        {/* ── Desktop metadata panel ── */}
        <div
          className="hidden md:flex flex-col w-72 xl:w-80 flex-shrink-0 border-l border-[var(--border-subtle)] overflow-y-auto"
          style={{ overscrollBehaviorY: "contain" }}
        >
          <div className="p-5">
            {metadataFields}
          </div>
        </div>
      </div>

      {/* ── Mobile metadata bottom sheet ── */}
      <BottomSheet open={metaOpen} onClose={() => setMetaOpen(false)}>
        {metadataFields}
      </BottomSheet>

      {/* ── Vue étendue (tap sur la carte) — image plein écran en fond +
          fiche métadonnées éditable par-dessus, comme dans la visionneuse
          de la bibliothèque (sticky image + sheet), mais ici avec édition. ── */}
      {img && (
        <BottomSheet
          open={expandedView}
          onClose={() => setExpandedView(false)}
          backdrop={
            <div className="w-full h-full bg-black flex items-center justify-center">
              <img
                src={getImageUrl(img.storageKey)}
                alt={current?.title ?? ""}
                className="max-w-full max-h-full object-contain"
                draggable={false}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={() => setExpandedView(false)}
                className="absolute w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white/90 text-base"
                style={{ top: "calc(env(safe-area-inset-top) + 10px)", right: 10 }}
                aria-label="Fermer"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
          }
        >
          {metadataFields}
        </BottomSheet>
      )}
    </div>
  );
}
