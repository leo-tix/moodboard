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
  /** Déclenche le chargement AVANT l'ouverture (survol du bouton). */
  precharger?: boolean;
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

export function ImageCloudModal({ open, precharger, onClose, dejaPosees, onAdd }: Props) {
  const [images, setImages] = useState<CloudImage[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [mode, setMode] = useState<CloudMode>("tags");
  const [progres, setProgres] = useState({ c: 0, t: 0 });
  const [vols, setVols] = useState<CarteEnVol[]>([]);
  const [ajoutees, setAjoutees] = useState(0);
  const [taille, setTaille] = useState(7);
  const scene = useRef<HTMLDivElement>(null);
  const volId = useRef(0);

  // Taille des vignettes : transmise par événement DOM, pas par prop. La
  // scène se remonterait autrement, et rechargerait tous les atlas pour un
  // simple changement d'échelle.
  useEffect(() => {
    scene.current?.querySelector<HTMLElement>("[data-cloud]")
      ?.dispatchEvent(new CustomEvent("cloud-taille", { detail: taille }));
  }, [taille]);

  // Chargé une SEULE fois, et si possible AVANT l'ouverture.
  //
  // Mesuré : entre le clic et la première image, 2,1 s partaient dans cet
  // appel (latence de la base) contre 100 ms pour monter toute la scène. Le
  // survol du bouton suffit à prendre cette avance, sans rien coûter à qui
  // n'ouvre jamais le nuage.
  useEffect(() => {
    if ((!open && !precharger) || images) return;
    let vivant = true;
    fetch("/api/library/cloud")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (vivant) setImages(d.images ?? []); })
      .catch(() => { if (vivant) setErreur("Impossible de charger la bibliothèque."); });
    return () => { vivant = false; };
  }, [open, precharger, images]);

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

        <label className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
          Taille
          <input
            type="range" min={3} max={16} step={0.5} value={taille}
            onChange={(e) => setTaille(Number(e.target.value))}
            className="w-24 accent-[var(--text-primary)]"
          />
        </label>

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
          <div ref={scene} className="absolute inset-0">
          <ImageCloudScene
            images={images}
            mode={mode}
            dejaPosees={dejaPosees}
            onPick={surPick}
            onProgres={(c, t) => setProgres({ c, t })}
          />
          </div>
        ) : null}

        <p className="pointer-events-none absolute bottom-4 right-5 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] leading-relaxed text-right">
          Glisser pour tourner<br />Molette pour zoomer<br />Cliquer pour ajouter
        </p>
      </div>

      {/* Cartes en vol — hors du flux, superposées à tout. */}
      {vols.map((c) => (
        <span
          key={c.id}
          className="pointer-events-none fixed z-[210] w-28 h-36 carte-vol"
          style={{ left: c.x - 56, top: c.y - 72 }}
        >
          <span className="carte-face">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.url} alt="" className="w-full h-full object-cover rounded-xl" />
            <span className="carte-holo" />
            <span className="carte-eclat" />
          </span>
        </span>
      ))}

      <style jsx global>{`
        /* CARTE À COLLECTIONNER.
           Structure et techniques reprises de pokemon-cards-css (S. Goellner) :
           un dégradé arc-en-ciel en color-dodge, des barres en hard-light
           et un halo radial en luminosity. C'est la
           superposition de ces trois couches, et non un simple reflet, qui
           donne la matière holographique. */
        .carte-vol {
          display: block;
          transform-style: preserve-3d;
          animation: carteVol 1s cubic-bezier(0.32, 0, 0.2, 1) forwards;
        }
        .carte-face {
          position: relative; display: block; width: 100%; height: 100%;
          border-radius: 0.75rem; overflow: hidden;
          box-shadow: 0 18px 50px -12px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.14);
        }
        .carte-face > span { position: absolute; inset: 0; pointer-events: none; }

        .carte-holo {
          background-image:
            repeating-linear-gradient(110deg,
              #a259ff 0%, #4d8bff 6%, #43e0a0 12%, #ffe259 18%, #ff5f6d 24%,
              #a259ff 30%, #4d8bff 36%, #43e0a0 42%, #ffe259 48%, #ff5f6d 54%,
              #a259ff 60%, #4d8bff 66%, #43e0a0 72%, #ffe259 78%, #ff5f6d 84%),
            repeating-linear-gradient(90deg,
              hsla(0, 0%, 70%, 0.45) 0 3%, hsla(0, 0%, 0%, 0.45) 3% 6%);
          background-size: 400% 400%, auto;
          background-blend-mode: overlay;
          mix-blend-mode: color-dodge;
          filter: brightness(1.1) contrast(1.1) saturate(1.2);
          opacity: 0.85;
          animation: holoDefile 1s linear forwards;
        }
        .carte-eclat {
          background: radial-gradient(farthest-corner circle at 32% 26%,
            hsla(0, 0%, 96%, 0.85) 0%, hsla(0, 0%, 78%, 0.12) 26%, hsl(0, 0%, 0%) 88%);
          mix-blend-mode: luminosity;
          filter: brightness(0.62) contrast(3.4);
          animation: eclatBalaye 1s ease-out forwards;
        }
        @keyframes holoDefile {
          0% { background-position: 0% 50%, 0 0; }
          100% { background-position: 220% 50%, 0 0; }
        }
        @keyframes eclatBalaye {
          0% { background-position: 0% 0%; opacity: 0.15; }
          40% { opacity: 1; }
          100% { background-position: 100% 100%; opacity: 0; }
        }

        /* La carte se retourne en filant vers le compteur d'ajouts : elle donne
           le sentiment d'un objet qu'on retourne et qu'on pose, plutôt que
           d'une vignette qui glisse. */
        @keyframes carteVol {
          0%   { transform: perspective(900px) rotateY(0deg) rotateZ(0deg) scale(1); opacity: 1; }
          20%  { transform: perspective(900px) rotateY(90deg) rotateZ(-4deg) scale(1.14); opacity: 1; }
          60%  { transform: perspective(900px) rotateY(360deg) rotateZ(6deg) scale(0.8) translate(19vw, -23vh); opacity: 1; }
          100% { transform: perspective(900px) rotateY(560deg) rotateZ(10deg) scale(0.16) translate(35vw, -41vh); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          /* Un objet qui tournoie à l'écran est un déclencheur classique de
             gêne vestibulaire : on garde l'information, pas le mouvement. */
          .carte-vol { animation: none; opacity: 0; transition: opacity 0.3s; }
          .carte-holo, .carte-eclat { animation: none; opacity: 0; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
