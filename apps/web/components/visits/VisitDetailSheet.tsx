"use client";

import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { getThumbnailUrl } from "@/lib/storage/urls";
import type { GlobalMapVisit } from "./VisitsGlobalMap";

interface VisitDetailSheetProps {
  visit: GlobalMapVisit | null;
  onClose: () => void;
}

// Bottom sheet mobile déclenché au tap d'un pin sur la carte cumulée
// (VisitsGlobalMap) — même pattern que AddToCollectionModal (framer-motion,
// portal, drag handle, backdrop cliquable), mais mobile only : sur desktop
// le carrousel bas suffit déjà (pas de trigger côté appelant).
export function VisitDetailSheet({ visit, onClose }: VisitDetailSheetProps) {
  if (typeof window === "undefined") return null;

  const content = visit && (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-[70]"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", bounce: 0, duration: 0.3 }}
        className="fixed z-[71] inset-x-0 bottom-0 w-full rounded-t-2xl bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-2xl flex flex-col"
        style={{ maxHeight: "70vh", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex justify-center pt-2.5 pb-0.5 flex-shrink-0">
          <div className="w-8 h-1 rounded-full bg-[var(--border-default)]" />
        </div>

        <div className="flex items-start justify-between px-4 pt-2 pb-1 flex-shrink-0">
          <div className="min-w-0">
            {visit.exhibition ? (
              <>
                <p className="font-serif text-lg text-[var(--text-primary)] truncate leading-tight">
                  {visit.exhibition}
                </p>
                <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">{visit.place}</p>
              </>
            ) : (
              <p className="font-serif text-lg text-[var(--text-primary)] truncate leading-tight">
                {visit.place}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors leading-none"
          >
            ✕
          </button>
        </div>

        {visit.thumbnailKey && (
          <div className="px-4 pt-1">
            <div className="aspect-video rounded-lg overflow-hidden bg-[var(--bg-surface)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getThumbnailUrl(visit.thumbnailKey)}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        )}

        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[var(--text-tertiary)]">
            {new Date(visit.visitDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
            {" · "}
            {visit.count} image{visit.count !== 1 ? "s" : ""}
          </p>
          <Link
            href={`/visites/${visit.id}`}
            className="flex-shrink-0 text-xs text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity"
          >
            Voir le carnet →
          </Link>
        </div>
      </motion.div>
    </>
  );

  return createPortal(<AnimatePresence>{content}</AnimatePresence>, document.body);
}
