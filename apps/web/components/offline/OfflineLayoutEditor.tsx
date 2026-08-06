"use client";

import { useMemo } from "react";
import { GripVertical, Mic, Type, Image as ImageIcon, PenLine, Minus } from "lucide-react";
import { useSortableGrid } from "@/hooks/useSortableGrid";
import { useBlobUrls } from "@/lib/offline/useBlobUrls";
import { DragHandle } from "@/components/ui/DragHandle";
import {
  DEFAULT_SPAN, formatOptions,
  type FormatOption, type JournalTileType, type TileWidth,
} from "@/lib/visits/bentoSpans";
import {
  setLocalLayout, TYPE_TUILE,
  type LocalBlock, type LocalVisit,
} from "@/lib/offline/localVisits";

type Tuile = NonNullable<LocalVisit["layout"]>[number];

/**
 * Disposition du carnet, éditable SANS RÉSEAU.
 *
 * La grille bento en ligne s'appuie sur des contenus servis par R2 ; hors
 * ligne, la moitié des blocs n'existe encore que sous forme de blob. On édite
 * donc l'ORDRE et le FORMAT sur une liste, pas sur la grille — même modèle de
 * données (`{type,id,w,h}`), mêmes formats autorisés par type, donc la synchro
 * n'a rien de particulier à faire : elle remappe les identifiants locaux vers
 * les identifiants serveur, comme pour une disposition construite en ligne.
 */
export function OfflineLayoutEditor({
  visit, onChange,
}: {
  visit: LocalVisit;
  onChange: (v: LocalVisit) => void;
}) {
  const urls = useBlobUrls(visit.blocks);

  // Disposition EFFECTIVE : celle qu'on a éditée, sinon l'ordre de capture avec
  // les formats par défaut — exactement ce que la synchro produirait en
  // l'absence de disposition. L'écran ne montre donc jamais autre chose que ce
  // qui partira réellement.
  const tuiles = useMemo<Tuile[]>(() => {
    const parId = new Map(visit.blocks.map((b) => [b.localId, b]));
    const existante = (visit.layout ?? []).filter((t) => parId.has(String(t.id)));
    const placees = new Set(existante.map((t) => String(t.id)));
    // Les blocs capturés APRÈS la dernière édition de disposition sont ajoutés
    // à la fin : ils ne doivent pas disparaître de l'écran sous prétexte
    // qu'aucune tuile ne les référence encore.
    const manquants = visit.blocks
      .filter((b) => !placees.has(b.localId))
      .map((b) => {
        const type = TYPE_TUILE[b.type];
        const span = DEFAULT_SPAN[type];
        return { type, id: b.localId, w: span.w, h: span.h } as Tuile;
      });
    return [...existante, ...manquants];
  }, [visit.blocks, visit.layout]);

  const enregistrer = async (suivantes: Tuile[]) => {
    const maj = await setLocalLayout(visit.localId, suivantes);
    if (maj) onChange(maj);
  };

  const sortable = useSortableGrid({
    onReorder: (deKey, versKey) => {
      const de = tuiles.findIndex((t) => String(t.id) === deKey);
      const vers = tuiles.findIndex((t) => String(t.id) === versKey);
      if (de < 0 || vers < 0 || de === vers) return;
      const copie = [...tuiles];
      const [deplacee] = copie.splice(de, 1);
      copie.splice(vers, 0, deplacee);
      void enregistrer(copie);
    },
    onDrop: () => {},
  });

  if (tuiles.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[var(--text-tertiary)]">
        Ordre et format des tuiles. Tout est appliqué au carnet à la synchronisation.
      </p>

      <ul className="space-y-1.5">
        {tuiles.map((t) => {
          const bloc = visit.blocks.find((b) => b.localId === String(t.id));
          if (!bloc) return null;
          const type = t.type as JournalTileType;
          const options = formatOptions(type);
          const key = String(t.id);

          return (
            <li
              key={key}
              {...sortable.getContainerProps(key)}
              className={`flex items-center gap-2 px-2 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] ${
                sortable.draggingKey === key ? "opacity-40" : ""
              }`}
            >
              {/* Tactile : poignée dédiée (le composant ne s'affiche qu'en
                  `pointer-coarse`). Souris : la ligne entière est saisissable,
                  d'où cette pastille purement indicative. */}
              <DragHandle {...sortable.getHandleProps(key)} className="shrink-0" />
              <GripVertical
                size={14} strokeWidth={2}
                className="hidden pointer-fine:block text-[var(--text-tertiary)] shrink-0 cursor-grab"
              />

              <Apercu bloc={bloc} url={urls[bloc.localId]} />

              <span className="flex-1 min-w-0">
                <span className="block text-xs text-[var(--text-primary)] truncate">
                  {libelle(bloc)}
                </span>
                <span className="block text-[10px] text-[var(--text-tertiary)]">{type}</span>
              </span>

              {options.length > 0 && (
                <SelecteurFormat
                  options={options}
                  actif={{ w: t.w as TileWidth, h: t.h }}
                  onChoisir={(o) =>
                    void enregistrer(tuiles.map((x) => (String(x.id) === key ? { ...x, w: o.w, h: o.h } : x)))
                  }
                />
              )}
            </li>
          );
        })}
      </ul>

      {/* Clone flottant du glisser-déposer (le hook le positionne). */}
      <div ref={sortable.overlayRef} style={sortable.overlayStyle} />
    </div>
  );
}

function libelle(b: LocalBlock): string {
  const p = b.payload ?? {};
  const titre = p.artworkTitle || p.eventName || p.title || p.label;
  if (typeof titre === "string" && titre.trim()) return titre;
  if (b.type === "note") return (b.content ?? "").replace(/<[^>]*>/g, " ").trim().slice(0, 60) || "Note";
  if (b.type === "memo") return "Mémo vocal";
  if (b.type === "photo") return "Photo";
  if (b.type === "sketch") return "Croquis";
  return "Sans titre";
}

function Apercu({ bloc, url }: { bloc: LocalBlock; url?: string }) {
  const classe = "w-8 h-8 rounded shrink-0 flex items-center justify-center bg-[var(--bg-elevated)]";
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />;
  }
  const Icone = bloc.type === "memo" ? Mic : bloc.type === "separator" ? Minus
    : bloc.type === "note" ? Type : bloc.type === "sketch" ? PenLine : ImageIcon;
  return (
    <span className={classe}>
      <Icone size={13} strokeWidth={1.7} className="text-[var(--text-tertiary)]" />
    </span>
  );
}

function SelecteurFormat({
  options, actif, onChoisir,
}: {
  options: FormatOption[];
  actif: { w: TileWidth; h: number };
  onChoisir: (o: FormatOption) => void;
}) {
  return (
    <span className="flex items-center gap-0.5 shrink-0">
      {options.map((o) => {
        const choisi = o.w === actif.w && o.h === actif.h;
        return (
          <button
            key={`${o.w}x${o.h}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onChoisir(o)}
            title={o.label}
            aria-label={o.label}
            aria-pressed={choisi}
            className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
              choisi ? "bg-[var(--text-primary)]" : "hover:bg-[var(--bg-elevated)]"
            }`}
          >
            {/* Le format est montré littéralement : un rectangle aux bonnes
                proportions se lit plus vite qu'un intitulé. */}
            <span
              className={choisi ? "bg-[var(--bg-base)]" : "bg-[var(--text-tertiary)]"}
              style={{
                width: o.w === 2 ? 12 : 6,
                height: o.h === 2 ? 12 : 6,
                borderRadius: 1.5,
                display: "block",
              }}
            />
          </button>
        );
      })}
    </span>
  );
}
