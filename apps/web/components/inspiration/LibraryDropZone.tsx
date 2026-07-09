"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface CollectionOption { id: string; name: string }
interface VisitOption { id: string; place: string; exhibition: string | null; visitDate: string }

export type DropTarget =
  | { type: "collection"; id: string; name: string }
  | { type: "visit"; id: string; name: string }
  | { type: "new-collection" }
  | { type: "new-visit" }
  | { type: "trash" };

export interface LibraryDropZoneHandle {
  /** Arme la confirmation de suppression pour ces ids (drop sur la corbeille) */
  armTrash: (ids: string[]) => void;
  /** Flash de succès sur le chip visé (drop réussi sur une collection/visite existante) */
  celebrate: (key: string) => void;
  /**
   * Recalcule le survol pour cette position pointeur — appelé en continu
   * pendant le drag. Volontairement impératif (pas de prop `dragPoint` +
   * useEffect) : faire transiter la position par le state React du parent
   * (LibraryClient, qui rend ~200 cartes) re-render toute la grille à chaque
   * pixel de déplacement et fait sauter la limite de mises à jour de React
   * ("Maximum update depth exceeded"). Ici, seul ce petit composant re-render,
   * et seulement quand la cible survolée change réellement.
   */
  updateHover: (x: number, y: number) => void;
}

interface LibraryDropZoneProps {
  /** null = pas de drag en cours (mais la barre peut rester visible plus
   * longtemps que ça — confirmation corbeille, flash de succès) */
  draggingIds: string[] | null;
  onDrop: (target: DropTarget, ids: string[]) => void;
}

const CELEBRATE_MS = 650;

function visitLabel(v: VisitOption): string {
  const date = new Date(v.visitDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return v.exhibition ? `${v.place} — ${v.exhibition}` : `${v.place} · ${date}`;
}

// Barre flottante de zones de dépôt — apparaît pendant qu'on drague une ou
// plusieurs images depuis la grille bibliothèque (souris immédiate, tactile
// via appui long — voir InspirationCard). Le survol des chips est déterminé
// par hit-testing (elementFromPoint) sur `dragPoint`, pas par les événements
// HTML5 dragover/drop natifs (le drag est piloté par Framer Motion, pas par
// l'API HTML5 Drag&Drop qui ne fonctionne pas au tactile).
//
// La barre reste volontairement visible au-delà de la fin du drag lui-même
// (draggingIds redevient null dès le relâchement) tant qu'une confirmation de
// suppression ou un flash de succès est en cours — sinon ces deux retours
// visuels n'auraient jamais le temps de s'afficher.
export const LibraryDropZone = forwardRef<LibraryDropZoneHandle, LibraryDropZoneProps>(
  function LibraryDropZone({ draggingIds, onDrop }, ref) {
    const [collections, setCollections] = useState<CollectionOption[]>([]);
    const [visits, setVisits] = useState<VisitOption[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [pendingTrash, setPendingTrash] = useState<string[] | null>(null);
    const [overKey, setOverKey] = useState<string | null>(null);
    const [successKey, setSuccessKey] = useState<string | null>(null);
    const celebrateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useImperativeHandle(ref, () => ({
      armTrash: (ids: string[]) => {
        navigator.vibrate?.(20);
        setPendingTrash(ids);
      },
      celebrate: (key: string) => {
        navigator.vibrate?.([12, 40, 12]);
        setSuccessKey(key);
        if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
        celebrateTimer.current = setTimeout(() => setSuccessKey(null), CELEBRATE_MS);
      },
      updateHover: (x: number, y: number) => {
        const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-key]");
        const key = el?.getAttribute("data-drop-key") ?? null;
        setOverKey((prev) => {
          if (key !== prev && key) navigator.vibrate?.(8); // petit tick à l'entrée d'une nouvelle zone
          return key;
        });
      },
    }));

    // Chargement paresseux — seulement au premier drag, pas au montage de la page
    useEffect(() => {
      if (!draggingIds || loaded) return;
      setLoaded(true);
      Promise.all([
        fetch("/api/collections").then((r) => r.json()),
        fetch("/api/visits").then((r) => r.json()),
      ])
        .then(([cols, vis]) => {
          setCollections((cols as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name })));
          setVisits(vis as VisitOption[]);
        })
        .catch(() => {});
    }, [draggingIds, loaded]);

    // Un NOUVEAU drag démarre → on repart d'un état propre (n'efface pas
    // pendingTrash/successKey quand draggingIds redevient null : c'est
    // justement ce qui doit garder la barre visible après le relâchement).
    useEffect(() => {
      if (draggingIds) { setPendingTrash(null); setSuccessKey(null); }
    }, [draggingIds]);

    // Fin de drag → plus de cible survolée (updateHover ne sera plus appelé)
    useEffect(() => {
      if (!draggingIds) setOverKey(null);
    }, [draggingIds]);

    const dragActive = draggingIds !== null && draggingIds.length > 0;
    const active = dragActive || pendingTrash !== null || successKey !== null;
    const chipBase =
      "flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs whitespace-nowrap transition-all";

    const chipClass = (key: string, dashed = false) =>
      cn(
        chipBase,
        successKey === key
          ? "border-green-500 bg-green-500/20 text-green-400 scale-110"
          : overKey === key && dragActive
          ? "border-[var(--accent,#a78bfa)] bg-[var(--accent,#a78bfa)]/20 scale-110"
          : dashed
          ? "border-dashed border-[var(--border-default)] text-[var(--text-secondary)]"
          : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
      );

    return (
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ type: "spring", bounce: 0.15, duration: 0.3 }}
            className="fixed top-4 inset-x-0 z-[9999] flex justify-center px-4 pointer-events-none"
          >
            {/* pointer-events-auto : nécessaire pour que elementFromPoint() détecte les
                chips pendant le drag — les éléments pointer-events:none sont exclus du
                hit-testing, y compris de elementFromPoint. */}
            <div className="pointer-events-auto flex items-center gap-1.5 bg-[var(--bg-elevated)]/95 backdrop-blur border border-[var(--border-default)] rounded-2xl shadow-2xl shadow-black/50 px-2 py-1.5 max-w-[calc(100vw-2rem)] overflow-x-auto scrollbar-none">
              {dragActive && (
                <span className="flex-shrink-0 text-[10px] text-[var(--text-tertiary)] px-2">
                  {draggingIds!.length > 1 ? `${draggingIds!.length} images ·` : ""} Déposer sur…
                </span>
              )}

              <div data-drop-key="new-collection" data-drop-target='{"type":"new-collection"}' className={chipClass("new-collection", true)}>
                + Collection
              </div>
              <div data-drop-key="new-visit" data-drop-target='{"type":"new-visit"}' className={chipClass("new-visit", true)}>
                + Visite
              </div>

              {collections.length > 0 && <div className="w-px h-6 bg-[var(--border-subtle)] flex-shrink-0" />}
              {collections.map((c) => (
                <div
                  key={c.id}
                  data-drop-key={`col-${c.id}`}
                  data-drop-target={JSON.stringify({ type: "collection", id: c.id, name: c.name })}
                  className={chipClass(`col-${c.id}`)}
                >
                  {successKey === `col-${c.id}` ? "✓" : "▣"} {c.name}
                </div>
              ))}

              {visits.length > 0 && <div className="w-px h-6 bg-[var(--border-subtle)] flex-shrink-0" />}
              {visits.map((v) => (
                <div
                  key={v.id}
                  data-drop-key={`visit-${v.id}`}
                  data-drop-target={JSON.stringify({ type: "visit", id: v.id, name: v.place })}
                  className={chipClass(`visit-${v.id}`)}
                  title={visitLabel(v)}
                >
                  {successKey === `visit-${v.id}` ? "✓" : "🏛"} {v.place}
                </div>
              ))}

              <div className="w-px h-6 bg-[var(--border-subtle)] flex-shrink-0" />

              {/* Corbeille — nécessite confirmation (armée par LibraryClient au drop) */}
              {pendingTrash ? (
                <div className="pointer-events-auto flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5">
                  <span className="text-[10px] text-red-400">Supprimer {pendingTrash.length} ?</span>
                  <button
                    onClick={() => { onDrop({ type: "trash" }, pendingTrash); setPendingTrash(null); }}
                    className="text-[10px] text-red-400 hover:text-red-300 font-medium"
                  >
                    Confirmer
                  </button>
                  <button
                    onClick={() => setPendingTrash(null)}
                    className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <div
                  data-drop-key="trash"
                  data-drop-target='{"type":"trash"}'
                  className={cn(
                    chipBase,
                    overKey === "trash" && dragActive
                      ? "border-red-500 bg-red-500/20 text-red-400 scale-110"
                      : "border-[var(--border-subtle)] text-[var(--text-tertiary)]"
                  )}
                  title="Supprimer"
                >
                  🗑
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }
);
