"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2 } from "lucide-react";
import { ImageCloudScene } from "@/components/moodboard/ImageCloudScene";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { MODES, type CloudMode } from "@/lib/moodboard/cloudLayout";
import type { CloudImage } from "@/app/api/library/cloud/route";

export interface CloudPick {
  inspirationId: string;
  storageKey: string;
  thumbnailKey: string;
  title: string;
  width: number | null;
  height: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Identifiants déjà présents sur la planche — assombris dans le nuage. */
  dejaPosees: Set<string>;
  onAdd: (pick: CloudPick) => void;
}

interface CarteEnVol {
  id: number;
  url: string;
  x: number;
  y: number;
}

export function ImageCloudModal({ open, onClose, dejaPosees, onAdd }: Props) {
  const [images, setImages] = useState<CloudImage[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [mode, setMode] = useState<CloudMode>("tags");
  const [progres, setProgres] = useState({ c: 0, t: 0 });
  const [vols, setVols] = useState<CarteEnVol[]>([]);
  const [ajoutees, setAjoutees] = useState(0);
  const volId = useRef(0);

  // Chargé à la PREMIÈRE ouverture seulement : la bibliothèque entière et ses
  // atlas coûtent trop cher pour être refaits à chaque aller-retour.
  useEffect(() => {
    if (!open || images) return;
    let vivant = true;
    fetch("/api/library/cloud")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (vivant) setImages(d.images ?? []); })
      .catch(() => { if (vivant) setErreur("Impossible de charger la bibliothèque."); });
    return () => { vivant = false; };
  }, [open, images]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  const surPick = useCallback(
    (img: CloudImage, x: number, y: number) => {
      onAdd({
        inspirationId: img.id,
        storageKey: img.s,
        thumbnailKey: img.k,
        title: img.t,
        width: img.w,
        height: img.h,
      });
      setAjoutees((n) => n + 1);
      // La carte part du point cliqué et file vers le coin bas-droit, où se
      // trouve le compteur : le geste reste lisible sans fermer le nuage, ce
      // qui permet d'enchaîner les ajouts.
      const id = ++volId.current;
      setVols((v) => [...v, { id, url: getThumbnailUrl(img.k), x, y }]);
      window.setTimeout(() => setVols((v) => v.filter((c) => c.id !== id)), 900);
    },
    [onAdd],
  );

  if (!open || typeof document === "undefined") return null;

  const chargement = !images || (progres.t > 0 && progres.c < progres.t);

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-[var(--bg-base)]/97 backdrop-blur-sm flex flex-col">
      {/* Barre : modes de tri à gauche, compteur et fermeture à droite. */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-[var(--border-subtle)] shrink-0">
        <div className="flex items-center gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                mode === m.id
                  ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <span className="ml-auto flex items-center gap-3 text-xs text-[var(--text-tertiary)]">
          {chargement && (
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" strokeWidth={2} />
              {progres.t > 0 ? `${progres.c} / ${progres.t}` : "Chargement"}
            </span>
          )}
          {ajoutees > 0 && (
            <span className="text-[var(--text-primary)]">
              {ajoutees} ajoutée{ajoutees > 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition-colors"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </span>
      </div>

      <div className="relative flex-1 min-h-0">
        {erreur ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-red-400">{erreur}</p>
        ) : images && images.length === 0 ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-tertiary)]">
            Ta bibliothèque est vide.
          </p>
        ) : images ? (
          <ImageCloudScene
            images={images}
            mode={mode}
            dejaPosees={dejaPosees}
            onPick={surPick}
            onProgres={(c, t) => setProgres({ c, t })}
          />
        ) : null}

        <p className="pointer-events-none absolute bottom-4 right-5 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] leading-relaxed text-right">
          Glisser pour tourner<br />Molette pour zoomer<br />Cliquer pour ajouter
        </p>
      </div>

      {/* Cartes en vol — hors du flux, superposées à tout. */}
      {vols.map((c) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={c.id}
          src={c.url}
          alt=""
          className="pointer-events-none fixed z-[210] w-28 h-28 object-cover rounded-xl shadow-2xl carte-vol"
          style={{ left: c.x - 56, top: c.y - 56 }}
        />
      ))}

      <style jsx global>{`
        /* La carte pivote sur elle-même en filant vers le compteur d'ajouts,
           puis disparaît. Rotation 3D plutôt qu'un simple glissement : elle
           donne le sentiment d'un objet qu'on retourne et qu'on pose. */
        @keyframes carteVol {
          0% { transform: perspective(900px) rotateY(0deg) scale(1); opacity: 1; }
          55% { transform: perspective(900px) rotateY(360deg) scale(0.78) translate(18vw, -22vh); opacity: 1; }
          100% { transform: perspective(900px) rotateY(540deg) scale(0.18) translate(34vw, -40vh); opacity: 0; }
        }
        .carte-vol { animation: carteVol 0.9s cubic-bezier(0.32, 0, 0.2, 1) forwards; }
        @media (prefers-reduced-motion: reduce) {
          /* Un objet qui tournoie à l'écran est un déclencheur classique de
             gêne vestibulaire : on garde l'information, pas le mouvement. */
          .carte-vol { animation: none; opacity: 0; transition: opacity 0.3s; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
