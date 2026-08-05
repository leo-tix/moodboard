// Synchronisation d'une visite créée HORS LIGNE (cf. docs/carnet-hors-ligne.md §4).
//
// ORDRE NON NÉGOCIABLE :
//   1. créer la visite               → on obtient son identifiant serveur
//   2. créer CHAQUE bloc             → on note son identifiant serveur au fur et à mesure
//   3. EN DERNIER, la disposition    → construite avec les identifiants serveur
//
// Si l'étape 3 partait avant que tous les blocs aient un identifiant, la
// disposition référencerait des identifiants inexistants et les tuiles
// DISPARAÎTRAIENT de la grille — le contenu resterait en base mais sortirait du
// carnet. C'est le risque principal du chantier.
//
// REPRISE : chaque identifiant obtenu est persisté immédiatement. Une synchro
// interrompue (appli tuée, réseau coupé) reprend là où elle s'était arrêtée, et
// un bloc déjà porteur d'un `serverId` n'est jamais renvoyé — donc pas de
// doublon. La visite n'est marquée `synced` QUE si l'étape 3 a abouti.

import { DEFAULT_SPAN } from "@/lib/visits/bentoSpans";
import {
  getLocalVisit,
  listLocalVisits,
  putLocalVisit,
  type LocalBlock,
  type LocalVisit,
} from "./localVisits";

export interface SyncResult {
  ok: boolean;
  serverId?: string;
  error?: string;
}

async function jsonOrThrow(res: Response, quoi: string): Promise<Record<string, unknown>> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `${quoi} — erreur ${res.status}`);
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** Étape 1 — la visite. Idempotente : ne recrée rien si `serverId` existe. */
async function ensureVisit(visit: LocalVisit): Promise<string> {
  if (visit.serverId) return visit.serverId;

  const res = await fetch("/api/visits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      place: visit.place,
      ...(visit.exhibition ? { exhibition: visit.exhibition } : {}),
      visitDate: visit.visitDate,
      ...(visit.latitude != null ? { latitude: visit.latitude } : {}),
      ...(visit.longitude != null ? { longitude: visit.longitude } : {}),
      ...(visit.address ? { address: visit.address } : {}),
    }),
  });
  const created = await jsonOrThrow(res, "Création de la visite");
  const serverId = String(created.id ?? "");
  if (!serverId) throw new Error("Le serveur n'a pas renvoyé d'identifiant de visite.");

  // Persisté AVANT toute autre requête : si l'application meurt juste après,
  // la reprise réutilisera cette visite au lieu d'en créer une seconde.
  visit.serverId = serverId;
  await putLocalVisit(visit);
  return serverId;
}

/** Étape 2 — un bloc. Renvoie son identifiant serveur. */
async function pushBlock(visitServerId: string, block: LocalBlock, visitTitle: string): Promise<string> {
  if (block.type === "note") {
    const res = await fetch(`/api/visits/${visitServerId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: block.content ?? "" }),
    });
    const note = await jsonOrThrow(res, "Envoi d'une note");
    return String(note.id ?? "");
  }

  if (block.type === "memo") {
    const fd = new FormData();
    fd.append("file", block.blob!, block.filename ?? "memo.webm");
    fd.append("durationSec", String(block.durationSec ?? 1));
    if (block.transcript) fd.append("transcript", block.transcript);
    if (block.wordTimings?.length) fd.append("wordTimings", JSON.stringify(block.wordTimings));
    const res = await fetch(`/api/visits/${visitServerId}/audio`, { method: "POST", body: fd });
    const audio = await jsonOrThrow(res, "Envoi d'un mémo vocal");
    return String(audio.id ?? "");
  }

  // photo : upload de l'image, puis rattachement à la visite
  const fd = new FormData();
  fd.append("file", block.blob!, block.filename ?? "photo.jpg");
  if (visitTitle) fd.append("title", visitTitle);
  const up = await fetch("/api/upload/image", { method: "POST", body: fd });
  const img = await jsonOrThrow(up, "Envoi d'une photo");
  const inspirationId = String(img.inspirationId ?? "");
  if (!inspirationId) throw new Error("Le serveur n'a pas renvoyé d'identifiant d'image.");

  const attach = await fetch(`/api/visits/${visitServerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addInspirationIds: [inspirationId] }),
  });
  await jsonOrThrow(attach, "Rattachement d'une photo");
  return inspirationId;
}

/** Étape 3 — la disposition, construite à partir des identifiants SERVEUR. */
async function pushLayout(visitServerId: string, blocks: LocalBlock[]): Promise<void> {
  const typeTuile = { photo: "image", memo: "audio", note: "note" } as const;
  const layout = blocks
    .filter((b) => b.serverId) // garde-fou : jamais d'identifiant local ici
    .map((b) => {
      const type = typeTuile[b.type];
      const span = DEFAULT_SPAN[type];
      return { type, id: b.serverId!, w: span.w, h: span.h };
    });
  if (layout.length === 0) return;

  const res = await fetch(`/api/visits/${visitServerId}/layout`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout }),
  });
  await jsonOrThrow(res, "Mise en page du carnet");
}

/**
 * Synchronise UNE visite locale. Sûre à rappeler : reprend où elle en était.
 */
export async function syncLocalVisit(localId: string): Promise<SyncResult> {
  const visit = await getLocalVisit(localId);
  if (!visit) return { ok: false, error: "Visite introuvable sur l'appareil." };
  if (visit.syncState === "synced" && visit.serverId) return { ok: true, serverId: visit.serverId };

  visit.syncState = "syncing";
  visit.lastError = undefined;
  await putLocalVisit(visit);

  try {
    const serverId = await ensureVisit(visit);
    const titre = visit.exhibition?.trim() || visit.place;

    for (const block of visit.blocks) {
      if (block.serverId) continue; // déjà envoyé lors d'une tentative précédente
      block.serverId = await pushBlock(serverId, block, titre);
      // LIBÉRATION IMMÉDIATE DU BLOB — dès que le serveur a confirmé le bloc,
      // le fichier existe sur R2 : le garder en double sur l'appareil ne
      // protège plus rien et sature le téléphone (une visite = 50-100 Mo de
      // photos). On ne le supprime QU'APRÈS confirmation, et une reprise n'en
      // a pas besoin puisqu'un bloc porteur d'un serverId n'est jamais renvoyé.
      block.blob = undefined;
      // Persistance APRÈS CHAQUE bloc : c'est ce qui rend la reprise possible
      // et empêche les doublons si l'envoi s'interrompt au milieu.
      visit.updatedAt = Date.now();
      await putLocalVisit(visit);
    }

    await pushLayout(serverId, visit.blocks);

    visit.syncState = "synced";
    visit.updatedAt = Date.now();
    await putLocalVisit(visit);
    return { ok: true, serverId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // On NE SUPPRIME RIEN : la visite reste intacte sur l'appareil, prête pour
    // une nouvelle tentative. Les blocs déjà envoyés ne repartiront pas.
    const frais = (await getLocalVisit(localId)) ?? visit;
    frais.syncState = "error";
    frais.lastError = message.slice(0, 200);
    await putLocalVisit(frais);
    return { ok: false, error: message };
  }
}

let enCours = false;

/**
 * Synchronise toutes les visites locales en attente. Le verrou évite qu'un
 * `online` et un retour au premier plan déclenchent deux passes concurrentes,
 * qui créeraient des doublons.
 */
export async function syncAllLocalVisits(): Promise<{ synced: number; failed: number }> {
  if (enCours) return { synced: 0, failed: 0 };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { synced: 0, failed: 0 };
  enCours = true;
  let synced = 0;
  let failed = 0;
  try {
    for (const v of await listLocalVisits()) {
      if (v.syncState === "synced") continue;
      const r = await syncLocalVisit(v.localId);
      if (r.ok) synced++;
      else failed++;
    }
  } finally {
    enCours = false;
  }
  return { synced, failed };
}
