"use client";

import { DEFAULT_SPAN, type JournalTileType, type TileWidth } from "@/lib/visits/bentoSpans";
import type { BentoTile, ChecklistItem, TimelineEvent } from "@/lib/visits/bentoTypes";
import { TYPE_TUILE, type LocalBlock, type LocalVisit } from "./localVisits";

/**
 * Blocs locaux → tuiles bento, dans la forme EXACTE attendue par les
 * composants du carnet en ligne.
 *
 * C'est ce qui permet d'afficher le carnet hors ligne avec `BentoGrid`,
 * `BentoTile` et `TileContent` tels quels, plutôt qu'avec une seconde
 * interface qui divergerait et perdrait l'utilisateur (demande du 2026-08-06).
 *
 * Les fichiers n'ont pas encore de clé R2 : on passe l'URL d'objet du blob là
 * où le rendu attend une clé. `getThumbnailUrl` / `getAudioUrl` laissent
 * passer une URL déjà absolue, donc rien à adapter côté tuiles.
 */
export function tuilesLocales(
  visit: LocalVisit,
  urls: Record<string, string>,
): BentoTile[] {
  const parId = new Map(visit.blocks.map((b) => [b.localId, b]));

  // Disposition explicite si elle existe, puis les blocs capturés depuis —
  // ils ne doivent pas disparaître faute de tuile qui les référence.
  const placees = new Set((visit.layout ?? []).map((t) => String(t.id)));
  const rangs: { id: string; w: TileWidth; h: number }[] = [
    ...(visit.layout ?? [])
      .filter((t) => parId.has(String(t.id)))
      .map((t) => ({ id: String(t.id), w: t.w as TileWidth, h: t.h })),
    ...visit.blocks
      .filter((b) => !placees.has(b.localId))
      .map((b) => {
        const span = DEFAULT_SPAN[TYPE_TUILE[b.type]];
        return { id: b.localId, w: span.w, h: span.h as number };
      }),
  ];

  const tuiles: BentoTile[] = [];
  for (const rang of rangs) {
    const bloc = parId.get(rang.id);
    if (!bloc) continue;
    const content = contenuDe(bloc, urls);
    if (!content) continue;
    tuiles.push({
      type: TYPE_TUILE[bloc.type] as JournalTileType,
      id: bloc.localId,
      w: rang.w,
      h: rang.h,
      content,
    } as BentoTile);
  }
  return tuiles;
}

function texte(v: unknown, defaut = ""): string {
  return typeof v === "string" ? v : defaut;
}
function texteOuNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function contenuDe(b: LocalBlock, urls: Record<string, string>): BentoTile["content"] | null {
  const id = b.localId;
  const p = b.payload ?? {};
  // URL du fichier principal (photo, croquis, mémo) ou du fichier joint à un
  // module (photo de billet, source de palette).
  const media = urls[id] ?? null;
  const joint = urls[`${id}:photo`] ?? null;

  switch (b.type) {
    case "photo":
      return { type: "image", id, title: "", author: null, year: null,
        thumbnailKey: media, storageKey: media, width: null, height: null };

    case "sketch":
      // `storageKey` est requis par le type : sans blob la tuile n'a rien à
      // montrer, on l'écarte plutôt que d'afficher un cadre vide.
      return media ? { type: "sketch", id, storageKey: media, thumbnailKey: media, width: null, height: null } : null;

    case "memo":
      return media ? { type: "audio", id, storageKey: media,
        durationSec: b.durationSec ?? null,
        transcript: b.transcript ?? null,
        wordTimings: b.wordTimings ?? null } : null;

    case "note":
      return { type: "note", id, content: b.content ?? "" };

    case "separator":
      return { type: "separator", id, label: texte(p.label, "Section") };

    case "highlight":
      return { type: "highlight", id, title: texte(p.title),
        rating: typeof p.rating === "number" ? p.rating : 0,
        note: texteOuNull(p.note) };

    case "checklist":
      return { type: "checklist", id, title: texteOuNull(p.title),
        items: Array.isArray(p.items) ? (p.items as ChecklistItem[]) : [] };

    case "timeline":
      return { type: "timeline", id, title: texteOuNull(p.title),
        events: Array.isArray(p.events) ? (p.events as TimelineEvent[]) : [] };

    case "cartel":
      return { type: "cartel", id, artworkTitle: texte(p.artworkTitle),
        artist: texteOuNull(p.artist), dateText: texteOuNull(p.dateText),
        medium: texteOuNull(p.medium), dimensions: texteOuNull(p.dimensions),
        room: texteOuNull(p.room), notes: texteOuNull(p.notes),
        storageKey: joint, thumbnailKey: joint, width: null, height: null };

    case "ticket":
      return { type: "ticket", id, eventName: texte(p.eventName),
        place: texteOuNull(p.place), dateText: texteOuNull(p.dateText),
        price: texteOuNull(p.price), category: texteOuNull(p.category),
        storageKey: joint, thumbnailKey: joint, width: null, height: null };

    case "palette":
      return { type: "palette", id, title: texteOuNull(p.title),
        colors: Array.isArray(p.colors) ? (p.colors as string[]) : [],
        sourceKey: joint };

    default:
      return null;
  }
}
