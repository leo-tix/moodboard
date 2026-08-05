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

export type LocalBlockType = "photo" | "memo" | "note";

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
  // Une visite modifiée après un échec redevient « à synchroniser ».
  if (visit.syncState === "error") visit.syncState = "local";
  await putLocalVisit(visit);
  return visit;
}

/** Poids approximatif des blobs d'une visite — pour l'affichage du stockage. */
export function localVisitBytes(visit: LocalVisit): number {
  return visit.blocks.reduce((n, b) => n + (b.blob?.size ?? 0), 0);
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
