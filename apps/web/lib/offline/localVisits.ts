// Visites créées HORS LIGNE, stockées sur l'appareil jusqu'à leur synchro.
//
// Modèle volontairement simple (cf. docs/carnet-hors-ligne.md §5) :
//  · une visite locale porte un `localId` préfixé `loc_` ;
//  · ses blocs sont une LISTE ORDONNÉE — l'ordre de capture fait foi.
//
// On ne stocke PAS de `journalLayout` hors ligne. La disposition bento est
// reconstruite à la synchro, une fois que chaque bloc possède son identifiant
// serveur. C'est ce qui supprime le risque décrit au §4 du document : une
// disposition ne peut pas référencer d'identifiants qui n'existent pas encore,
// puisqu'elle n'est fabriquée qu'à la toute fin.
//
// Types de blocs limités à ce qu'on capture réellement pendant une visite :
// photo, mémo vocal, note de texte. Les modules riches (cartel, billet,
// palette, frise…) restent en ligne — ils s'ajoutent au carnet après coup.

import { openDb, STORE_VISITS } from "./db";
import type { JournalTileType } from "@/lib/visits/bentoSpans";

// Tous les types éditables hors ligne. Les types intrinsèquement distants
// (carte, lien/YouTube, fiche wiki) sont grisés dans le sélecteur et n'arrivent
// donc jamais ici.
export type LocalBlockType =
  | "photo" | "memo" | "note"
  | "highlight" | "checklist" | "timeline" | "cartel" | "ticket" | "palette" | "separator"
  | "sketch";

/**
 * Type de TUILE correspondant à un type de bloc local.
 *
 * Les deux vocabulaires diffèrent pour trois entrées : on capture une « photo »
 * et un « mémo », le carnet affiche une « image » et un « audio ». La table
 * vivait dans `pushLayout` ; elle est partagée depuis que l'interface hors
 * ligne édite elle aussi la disposition — les formats proposés dépendent du
 * type de tuile, et une divergence entre l'écran et la synchro produirait une
 * disposition refusée par le serveur.
 */
export const TYPE_TUILE: Record<LocalBlockType, JournalTileType> = {
  photo: "image", memo: "audio", note: "note", sketch: "sketch",
  highlight: "highlight", checklist: "checklist", timeline: "timeline",
  cartel: "cartel", ticket: "ticket", palette: "palette", separator: "separator",
};

export interface LocalBlock {
  localId: string;
  type: LocalBlockType;
  /** Rempli au fil de la synchro — sert aussi de marqueur « déjà envoyé ». */
  serverId?: string;
  /** note */
  content?: string;
  /** photo / mémo */
  blob?: Blob;
  filename?: string;
  /** mémo */
  durationSec?: number;
  transcript?: string;
  wordTimings?: { word: string; start: number; end: number }[];
  /** Fichiers rattachés à un MODULE (photo de billet, image source d'une
   *  palette). Volontairement HORS de `payload` : celui-ci part en JSON à la
   *  synchro, et un Blob y serait sérialisé en `{}` — le fichier disparaîtrait
   *  en silence. Ces fichiers partent en FormData sur la sous-route du module,
   *  une fois celui-ci créé côté serveur. */
  files?: Record<string, { blob: Blob; filename: string }>;
  /** Modules de données (coup de cœur, checklist, frise, cartel, billet,
   *  palette, séparateur) : contenu libre, miroir des colonnes de la table
   *  correspondante. Envoyé tel quel à la sous-route API à la synchro. */
  payload?: Record<string, unknown>;
  createdAt: number;
}

export type SyncState = "local" | "syncing" | "synced" | "error";

export interface LocalVisit {
  localId: string;
  /** Rempli dès que la visite existe côté serveur. */
  serverId?: string;
  place: string;
  exhibition?: string | null;
  visitDate: string; // AAAA-MM-JJ
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  blocks: LocalBlock[];
  /** Disposition bento éditée hors ligne. Elle référence les identifiants
   *  LOCAUX des blocs ; ils sont remappés vers les identifiants serveur au
   *  moment de la synchro (cf. syncVisits.ts). */
  layout?: { type: string; id: string; w: number; h: number; [k: string]: unknown }[];
  createdAt: number;
  updatedAt: number;
  syncState: SyncState;
  lastError?: string;
}

export const LOCAL_VISITS_EVENT = "moodboard-local-visits";

function notify() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LOCAL_VISITS_EVENT));
  }
}

export function newLocalId(prefix = "loc"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function listLocalVisits(): Promise<LocalVisit[]> {
  const db = await openDb();
  try {
    const rows = await new Promise<LocalVisit[]>((resolve, reject) => {
      const tx = db.transaction(STORE_VISITS, "readonly");
      const req = tx.objectStore(STORE_VISITS).getAll();
      req.onsuccess = () => resolve((req.result as LocalVisit[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}

export async function getLocalVisit(localId: string): Promise<LocalVisit | null> {
  const db = await openDb();
  try {
    return await new Promise<LocalVisit | null>((resolve, reject) => {
      const tx = db.transaction(STORE_VISITS, "readonly");
      const req = tx.objectStore(STORE_VISITS).get(localId);
      req.onsuccess = () => resolve((req.result as LocalVisit) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function putLocalVisit(visit: LocalVisit): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_VISITS, "readwrite");
      tx.objectStore(STORE_VISITS).put(visit);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  notify();
}

export async function deleteLocalVisit(localId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_VISITS, "readwrite");
      tx.objectStore(STORE_VISITS).delete(localId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  notify();
}

export async function createLocalVisit(input: {
  place: string;
  exhibition?: string | null;
  visitDate: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
}): Promise<LocalVisit> {
  const now = Date.now();
  const visit: LocalVisit = {
    localId: newLocalId(),
    place: input.place,
    exhibition: input.exhibition ?? null,
    visitDate: input.visitDate,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    address: input.address ?? null,
    blocks: [],
    layout: [],
    createdAt: now,
    updatedAt: now,
    syncState: "local",
  };
  await putLocalVisit(visit);
  return visit;
}

/** Ajoute un bloc à une visite locale. Renvoie la visite mise à jour. */
export async function appendLocalBlock(
  localId: string,
  block: Omit<LocalBlock, "localId" | "createdAt">,
): Promise<LocalVisit | null> {
  const visit = await getLocalVisit(localId);
  if (!visit) return null;
  visit.blocks.push({ ...block, localId: newLocalId("blk"), createdAt: Date.now() });
  visit.updatedAt = Date.now();
  // Toute visite qui reçoit un bloc redevient « à synchroniser » — y compris
  // une visite DÉJÀ synchronisée : on continue de capturer dedans après son
  // départ, ce qui est le cas d'usage réel en visite. Son `serverId` est
  // conservé, donc la synchro n'en recréera pas une seconde : elle se contente
  // d'envoyer les nouveaux blocs et de les AJOUTER à la disposition existante.
  if (visit.syncState !== "syncing") visit.syncState = "local";
  await putLocalVisit(visit);
  return visit;
}

/** Remplace la disposition locale (ordre + formats). */
export async function setLocalLayout(
  localId: string,
  layout: NonNullable<LocalVisit["layout"]>,
): Promise<LocalVisit | null> {
  const visit = await getLocalVisit(localId);
  if (!visit) return null;
  visit.layout = layout;
  visit.updatedAt = Date.now();
  if (visit.syncState !== "syncing") visit.syncState = "local";
  await putLocalVisit(visit);
  return visit;
}

/** Met à jour le contenu d'un bloc local (édition d'un module). */
export async function patchLocalBlock(
  localId: string,
  blockLocalId: string,
  payload: Record<string, unknown>,
): Promise<LocalVisit | null> {
  const visit = await getLocalVisit(localId);
  if (!visit) return null;
  const b = visit.blocks.find((x) => x.localId === blockLocalId);
  if (!b) return null;
  b.payload = { ...(b.payload ?? {}), ...payload };
  visit.updatedAt = Date.now();
  if (visit.syncState !== "syncing") visit.syncState = "local";
  await putLocalVisit(visit);
  return visit;
}

/** Rattache un fichier à un bloc-module (photo de billet, source de palette). */
export async function attachLocalFile(
  localId: string,
  blockLocalId: string,
  cle: string,
  blob: Blob,
  filename: string,
): Promise<LocalVisit | null> {
  const visit = await getLocalVisit(localId);
  if (!visit) return null;
  const b = visit.blocks.find((x) => x.localId === blockLocalId);
  if (!b) return null;
  b.files = { ...(b.files ?? {}), [cle]: { blob, filename } };
  visit.updatedAt = Date.now();
  if (visit.syncState !== "syncing") visit.syncState = "local";
  await putLocalVisit(visit);
  return visit;
}

/** Supprime un bloc local (et sa tuile dans la disposition). */
export async function removeLocalBlock(localId: string, blockLocalId: string): Promise<LocalVisit | null> {
  const visit = await getLocalVisit(localId);
  if (!visit) return null;
  visit.blocks = visit.blocks.filter((b) => b.localId !== blockLocalId);
  visit.layout = (visit.layout ?? []).filter((t) => t.id !== blockLocalId);
  visit.updatedAt = Date.now();
  if (visit.syncState !== "syncing") visit.syncState = "local";
  await putLocalVisit(visit);
  return visit;
}

/** Poids approximatif des blobs d'une visite — pour l'affichage du stockage. */
export function localVisitBytes(visit: LocalVisit): number {
  return visit.blocks.reduce(
    (n, b) => n + (b.blob?.size ?? 0)
      + Object.values(b.files ?? {}).reduce((m, f) => m + f.blob.size, 0),
    0,
  );
}

// ── Rétention ──────────────────────────────────────────────────────────────
// RÈGLE ABSOLUE : on ne supprime JAMAIS une donnée que le serveur n'a pas
// confirmée. Ni au bout d'un délai, ni sous pression de stockage — dans ce
// dernier cas on avertit l'utilisateur, on n'efface pas.
//
// Une fois la visite entièrement synchronisée, ses fichiers vivent sur R2 et
// ses blocs en base : la copie locale ne protège plus rien. Ses blobs ont déjà
// été libérés bloc par bloc à la synchro (voir syncVisits.ts) ; il ne reste
// qu'une fiche de quelques centaines d'octets, gardée un temps pour que
// l'utilisateur voie ce qui est parti, puis effacée.
const RETENTION_SYNCED_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

export async function pruneSyncedVisits(now = Date.now()): Promise<number> {
  const visites = await listLocalVisits();
  let supprimees = 0;
  for (const v of visites) {
    if (v.syncState !== "synced") continue;          // jamais si non confirmé
    if (now - v.updatedAt < RETENTION_SYNCED_MS) continue;
    await deleteLocalVisit(v.localId);
    supprimees++;
  }
  return supprimees;
}

/** Octets réellement retenus sur l'appareil (blobs non encore confirmés). */
export async function pendingLocalBytes(): Promise<number> {
  return (await listLocalVisits()).reduce((n, v) => n + localVisitBytes(v), 0);
}
