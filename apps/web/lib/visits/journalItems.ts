import type { JournalItem, JournalBlock } from "@/lib/visits/legacyJournalTypes";
import { DEFAULT_SPAN, type JournalTile } from "@/lib/visits/bentoSpans";
import type { BentoTile, JournalTileContent } from "@/lib/visits/bentoTypes";

// Construit la séquence de blocs du carnet (façon Notion) à partir des 6 tables
// de blocs d'une visite. Extrait de la page de détail pour être réutilisé par la
// page publique read-only (Phase 5) — même logique de fusion/tri/claim, une
// seule source de vérité.
//
// NOTE (2026-07-15) : buildJournalItems() ne sert plus qu'au script de
// migration one-shot vers la grille bento (voir buildBentoLayout ci-dessous,
// désormais la source de vérité pour l'éditeur et le carnet public).

export interface JournalSourceVisit {
  inspirations: {
    id: string;
    title: string;
    author: string | null;
    year: number | null;
    visitOrder: number;
    createdAt: Date;
    images: { storageKey: string; thumbnailKey: string | null; width: number | null; height: number | null }[];
  }[];
  noteBlocks: { id: string; content: string; order: number; createdAt: Date }[];
  titleBlocks: { id: string; content: string; order: number; createdAt: Date }[];
  quoteBlocks: { id: string; content: string; order: number; createdAt: Date }[];
  audioClips: { id: string; storageKey: string; durationSec: number | null; transcript: string | null; order: number; createdAt: Date }[];
  columnBlocks: { id: string; left: unknown; right: unknown; order: number; createdAt: Date }[];
  embeds: { id: string; kind: "LINK" | "YOUTUBE"; url: string; title: string | null; description: string | null; image: string | null; siteName: string | null; order: number; createdAt: Date }[];
}

type BlockLookupKey = `${"image" | "note" | "title" | "quote" | "audio"}-${string}`;

const REF_TO_KEY: Record<string, "image" | "note" | "title" | "quote" | "audio"> = {
  IMAGE: "image",
  TEXT: "note",
  TITLE: "title",
  QUOTE: "quote",
  AUDIO: "audio",
};

export function buildJournalItems(visit: JournalSourceVisit): JournalItem[] {
  const blocks = new Map<BlockLookupKey, JournalBlock>();
  visit.inspirations.forEach((i) => {
    blocks.set(`image-${i.id}`, {
      type: "image",
      id: i.id,
      title: i.title,
      author: i.author,
      year: i.year,
      thumbnailKey: i.images[0]?.thumbnailKey ?? null,
      width: i.images[0]?.width ?? null,
      height: i.images[0]?.height ?? null,
    });
  });
  visit.noteBlocks.forEach((n) => blocks.set(`note-${n.id}`, { type: "note", id: n.id, content: n.content }));
  visit.titleBlocks.forEach((t) => blocks.set(`title-${t.id}`, { type: "title", id: t.id, content: t.content }));
  visit.quoteBlocks.forEach((q) => blocks.set(`quote-${q.id}`, { type: "quote", id: q.id, content: q.content }));
  visit.audioClips.forEach((a) =>
    blocks.set(`audio-${a.id}`, { type: "audio", id: a.id, storageKey: a.storageKey, durationSec: a.durationSec, transcript: a.transcript }),
  );

  const resolveStack = (stack: unknown): JournalBlock[] =>
    (Array.isArray(stack) ? stack : [])
      .map((ref) => {
        const r = ref as { type?: string; id?: string };
        return r?.type && r?.id ? blocks.get(`${REF_TO_KEY[r.type]}-${r.id}`) : undefined;
      })
      .filter((b): b is JournalBlock => Boolean(b));

  const claimed = new Set<BlockLookupKey>();
  visit.columnBlocks.forEach((c) => {
    resolveStack(c.left).forEach((b) => claimed.add(`${b.type}-${b.id}`));
    resolveStack(c.right).forEach((b) => claimed.add(`${b.type}-${b.id}`));
  });

  const merged: { item: JournalItem; order: number; createdAt: Date }[] = [];
  visit.inspirations.forEach((i) => {
    if (!claimed.has(`image-${i.id}`)) merged.push({ item: blocks.get(`image-${i.id}`)!, order: i.visitOrder, createdAt: i.createdAt });
  });
  visit.noteBlocks.forEach((n) => {
    if (!claimed.has(`note-${n.id}`)) merged.push({ item: blocks.get(`note-${n.id}`)!, order: n.order, createdAt: n.createdAt });
  });
  visit.titleBlocks.forEach((t) => {
    if (!claimed.has(`title-${t.id}`)) merged.push({ item: blocks.get(`title-${t.id}`)!, order: t.order, createdAt: t.createdAt });
  });
  visit.quoteBlocks.forEach((q) => {
    if (!claimed.has(`quote-${q.id}`)) merged.push({ item: blocks.get(`quote-${q.id}`)!, order: q.order, createdAt: q.createdAt });
  });
  visit.audioClips.forEach((a) => {
    if (!claimed.has(`audio-${a.id}`)) merged.push({ item: blocks.get(`audio-${a.id}`)!, order: a.order, createdAt: a.createdAt });
  });
  visit.columnBlocks.forEach((c) => {
    merged.push({
      item: { type: "columns", id: c.id, left: resolveStack(c.left), right: resolveStack(c.right) },
      order: c.order,
      createdAt: c.createdAt,
    });
  });
  // Blocs lien/embed — top-level uniquement, jamais réclamés par une colonne.
  visit.embeds.forEach((e) => {
    merged.push({
      item: {
        type: "embed",
        id: e.id,
        kind: e.kind,
        url: e.url,
        title: e.title,
        description: e.description,
        image: e.image,
        siteName: e.siteName,
      },
      order: e.order,
      createdAt: e.createdAt,
    });
  });

  merged.sort((a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime());
  return merged.map((m) => m.item);
}

// ── Grille bento (2026-07-15) ────────────────────────────────────────────────

export interface BentoSourceVisit {
  journalLayout: unknown; // Json — JournalTile[], validé/filtré ici
  inspirations: JournalSourceVisit["inspirations"];
  noteBlocks: JournalSourceVisit["noteBlocks"];
  audioClips: JournalSourceVisit["audioClips"];
  embeds: JournalSourceVisit["embeds"];
  mapBlocks: { id: string; locationName: string; latitude: number; longitude: number }[];
}

// Résout Visit.journalLayout (position/format) vers son contenu réel, table
// par table — remplace buildJournalItems() comme source de vérité pour
// l'éditeur (VisitJournal) et le carnet public (VisitJournalReadOnly).
export function buildBentoLayout(visit: BentoSourceVisit): BentoTile[] {
  const content = new Map<string, JournalTileContent>();
  visit.inspirations.forEach((i) => {
    content.set(`image-${i.id}`, {
      type: "image",
      id: i.id,
      title: i.title,
      author: i.author,
      year: i.year,
      thumbnailKey: i.images[0]?.thumbnailKey ?? null,
      width: i.images[0]?.width ?? null,
      height: i.images[0]?.height ?? null,
    });
  });
  visit.noteBlocks.forEach((n) => content.set(`note-${n.id}`, { type: "note", id: n.id, content: n.content }));
  visit.audioClips.forEach((a) =>
    content.set(`audio-${a.id}`, { type: "audio", id: a.id, storageKey: a.storageKey, durationSec: a.durationSec, transcript: a.transcript }),
  );
  visit.embeds.forEach((e) =>
    content.set(`embed-${e.id}`, {
      type: "embed",
      id: e.id,
      kind: e.kind,
      url: e.url,
      title: e.title,
      description: e.description,
      image: e.image,
      siteName: e.siteName,
    }),
  );
  visit.mapBlocks.forEach((m) =>
    content.set(`map-${m.id}`, { type: "map", id: m.id, locationName: m.locationName, latitude: m.latitude, longitude: m.longitude }),
  );

  const layout: JournalTile[] = Array.isArray(visit.journalLayout) ? (visit.journalLayout as JournalTile[]) : [];
  const seen = new Set<string>();
  const resolved: BentoTile[] = [];
  for (const tile of layout) {
    const key = `${tile.type}-${tile.id}`;
    const c = content.get(key);
    if (!c) continue; // référence obsolète (contenu supprimé) — abandonnée silencieusement, même filet que resolveStack ci-dessus
    seen.add(key);
    resolved.push({ ...tile, content: c });
  }
  // Filet de sécurité : un bloc créé dont l'ajout à journalLayout aurait
  // échoué (PATCH réseau perdu juste après la création du contenu) resterait
  // sinon invisible pour toujours — on l'ajoute en fin de grille avec son
  // format par défaut plutôt que de le faire disparaître silencieusement.
  for (const [key, c] of content) {
    if (seen.has(key)) continue;
    const span = DEFAULT_SPAN[c.type];
    resolved.push({ type: c.type, id: c.id, w: span.w, h: span.h, content: c });
  }
  return resolved;
}
