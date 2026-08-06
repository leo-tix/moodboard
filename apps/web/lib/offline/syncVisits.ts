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
  TYPE_TUILE,
  type LocalBlock,
  type LocalVisit,
} from "./localVisits";
import { serverReachable } from "./useServerReachable";

export interface SyncResult {
  ok: boolean;
  serverId?: string;
  error?: string;
}

async function jsonOrThrow(res: Response, quoi: string): Promise<Record<string, unknown>> {
  // SESSION EXPIRÉE — cas courant après plusieurs heures hors ligne. Le proxy
  // renvoie alors la page de connexion : une réponse 200 en HTML. Sans ce
  // test, `res.ok` est vrai, `res.json()` échoue en silence et l'appelant
  // conclut « le serveur n'a pas renvoyé d'identifiant » — un message trompeur
  // pour un échec que seul un reconnexion résout (constaté le 2026-08-06).
  const ct = res.headers.get("content-type") ?? "";
  if (res.ok && !ct.includes("json")) {
    throw new Error("Session expirée — rouvre l'application en ligne pour te reconnecter, puis réessaie.");
  }
  if (res.status === 401) {
    throw new Error("Session expirée — reconnecte-toi, puis réessaie l'envoi.");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    // `error` est une CHAÎNE sur nos routes métier, mais un OBJET zod (issu de
    // `error.flatten()`) sur un rejet de validation. Le passer tel quel à
    // `new Error` donnait « [object Object] » — soit un échec de synchro sans
    // motif lisible. On aplatit, et on garde toujours l'opération + le code.
    const brut = data.error;
    let motif = "";
    if (typeof brut === "string") motif = brut;
    else if (brut && typeof brut === "object") {
      const f = brut as { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
      const champs = Object.entries(f.fieldErrors ?? {}).map(([c, m]) => `${c} : ${m.join(", ")}`);
      motif = [...(f.formErrors ?? []), ...champs].join(" · ") || JSON.stringify(brut).slice(0, 120);
    }
    throw new Error(`${quoi} — ${res.status}${motif ? ` : ${motif}` : ""}`);
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/**
 * La visite visée par `serverId` existe-t-elle ENCORE et m'appartient-elle ?
 *
 * Une visite locale déjà synchronisée garde l'identifiant serveur obtenu. Si
 * cette visite est supprimée côté serveur entre temps, chaque tentative
 * suivante tape dans le vide : les routes répondent 404 « Introuvable » et la
 * visite locale reste bloquée POUR TOUJOURS, avec son contenu prisonnier
 * (constaté le 2026-08-06 : « Envoi d'un module ticket — 404 »).
 *
 * `null` = on ne sait pas (réseau) : dans le doute on ne touche à rien.
 */
async function visiteEncoreLa(serverId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`/api/visits/${serverId}/layout`);
    if (res.status === 404) return false;
    if (res.ok) return true;
    return null;                       // 401, 500… : indécidable
  } catch {
    return null;                       // hors ligne : indécidable
  }
}

/**
 * La visite distante a disparu : on oublie tous les identifiants serveur pour
 * que la synchro la RECRÉE au lieu de s'acharner. Aucun risque de doublon —
 * la visite d'origine n'existe plus.
 *
 * Un bloc dont le fichier a déjà été libéré ne peut plus être renvoyé ; on
 * garde son identifiant mort pour qu'il soit sauté, et on le compte. Ses
 * images restent dans la bibliothèque : la suppression d'une visite ne détruit
 * pas les inspirations rattachées.
 */
function oublierLeServeur(visit: LocalVisit): number {
  visit.serverId = undefined;
  let irrecuperables = 0;
  for (const b of visit.blocks) {
    const renvoyable =
      b.type === "note" || b.type === "separator" || !!b.payload || !!b.blob;
    if (renvoyable) b.serverId = undefined;
    else if (b.serverId) irrecuperables++;
  }
  return irrecuperables;
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
// Modules de DONNÉES : une sous-route par type, même contrat (POST → { id }).
// Au niveau du module car `pushBlockFiles` s'en sert aussi pour composer
// l'adresse de la sous-route fichier `/<module>/<id>/photo`.
const SOUS_ROUTE: Partial<Record<string, string>> = {
  highlight: "highlight", checklist: "checklist", timeline: "timeline",
  cartel: "cartel", ticket: "ticket", palette: "palette",
};

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

  const route = SOUS_ROUTE[block.type];
  if (route) {
    // Les champs NULS sont OMIS, pas envoyés à null : plusieurs schémas de
    // création déclarent un champ `.optional()` sans `.nullable()` (ainsi
    // `note` du coup de cœur), et un null y provoque un rejet de validation —
    // donc un échec d'envoi bloquant. Omettre est toujours accepté, envoyer
    // null ne l'est pas systématiquement (constaté le 2026-08-06).
    const corps = Object.fromEntries(
      Object.entries(block.payload ?? {}).filter(([, v]) => v !== null && v !== undefined),
    );
    const res = await fetch(`/api/visits/${visitServerId}/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
    });
    const cree = await jsonOrThrow(res, `Envoi d'un module ${block.type}`);
    return String(cree.id ?? "");
  }

  // Croquis : dessin réalisé sur place, envoyé comme fichier (même contrat que
  // les photos et les mémos : FormData + champ `file`).
  if (block.type === "sketch") {
    const fd = new FormData();
    fd.append("file", block.blob!, block.filename ?? "croquis.png");
    const res = await fetch(`/api/visits/${visitServerId}/sketch`, { method: "POST", body: fd });
    const cree = await jsonOrThrow(res, "Envoi d'un croquis");
    return String(cree.id ?? "");
  }

  // Séparateur : pas de table dédiée, son libellé vit DANS la disposition.
  // Il n'a donc rien à créer côté serveur ; son identifiant local fait foi.
  if (block.type === "separator") return block.localId;

  // photo : upload de l'image, puis rattachement à la visite
  const fd = new FormData();
  fd.append("file", block.blob!, block.filename ?? "photo.jpg");
  // Titre saisi dans les réglages de la tuile hors ligne, sinon le nom de la
  // visite (comportement par défaut en ligne). Sans cette priorité, une
  // légende écrite pendant la visite serait perdue à l'envoi.
  const titrePhoto = typeof block.payload?.title === "string" && block.payload.title.trim()
    ? block.payload.title.trim()
    : visitTitle;
  if (titrePhoto) fd.append("title", titrePhoto);
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

/** Étape 3 — la disposition, construite à partir des identifiants SERVEUR.
 *
 *  FUSION, pas remplacement. Quand on ajoute des blocs à une visite déjà
 *  synchronisée, l'utilisateur a pu réorganiser ses tuiles en ligne entre
 *  temps : reconstruire la disposition depuis l'ordre local écraserait son
 *  arrangement. On lit donc l'existant et on n'y AJOUTE que les tuiles absentes.
 */
/**
 * Fichiers d'un module (photo de billet, source de palette) — envoyés sur la
 * sous-route `/<module>/<id>/photo`, donc seulement une fois le module créé.
 * Idempotent : `block.files` est vidé après confirmation, et un bloc sans
 * fichier en attente ne repasse pas ici.
 */
async function pushBlockFiles(visitServerId: string, block: LocalBlock): Promise<void> {
  const route = SOUS_ROUTE[block.type];
  const fichiers = Object.entries(block.files ?? {});
  if (!route || !block.serverId || fichiers.length === 0) return;

  for (const [, f] of fichiers) {
    const fd = new FormData();
    fd.append("file", f.blob, f.filename);
    const res = await fetch(
      `/api/visits/${visitServerId}/${route}/${block.serverId}/photo`,
      { method: "POST", body: fd },
    );
    await jsonOrThrow(res, "Envoi de la photo d'un module");
  }
  // Libéré comme les blobs de capture : le fichier vit sur R2, le garder en
  // double ne protège plus rien.
  block.files = undefined;
}

async function pushLayout(
  visitServerId: string,
  blocks: LocalBlock[],
  layoutLocal?: LocalVisit["layout"],
): Promise<void> {
  const tuileDe = (t: string) => TYPE_TUILE[t as keyof typeof TYPE_TUILE] ?? t;

  // REMAPPAGE : la disposition éditée hors ligne référence les identifiants
  // LOCAUX. On les traduit en identifiants serveur ici, à la toute fin, quand
  // chaque bloc en possède un. Une tuile dont le bloc n'a pas été confirmé est
  // ÉCARTÉE plutôt que référencée à vide — c'est ce qui ferait disparaître des
  // tuiles de la grille (docs/carnet-hors-ligne.md §4).
  const versServeur = new Map(blocks.filter((b) => b.serverId).map((b) => [b.localId, b.serverId!]));

  const locales = (layoutLocal && layoutLocal.length > 0)
    // Disposition explicitement éditée hors ligne : on la respecte.
    ? layoutLocal
        .map((t) => {
          const id = versServeur.get(String(t.id)) ?? null;
          return id ? { ...t, id, type: tuileDe(String(t.type)) } : null;
        })
        .filter((t): t is NonNullable<typeof t> => t !== null)
    // Sinon : ordre de capture, formats par défaut.
    : blocks
        .filter((b) => b.serverId)
        .map((b) => {
          const type = tuileDe(b.type);
          const span = DEFAULT_SPAN[type as keyof typeof DEFAULT_SPAN] ?? { w: 2, h: 1 };
          return { type, id: b.serverId!, w: span.w, h: span.h };
        });
  if (locales.length === 0) return;

  // Disposition déjà en place côté serveur (vide pour une visite neuve).
  let existante: { type: string; id: string }[] = [];
  try {
    const res = await fetch(`/api/visits/${visitServerId}/layout`);
    if (res.ok) {
      const data = (await res.json()) as { layout?: { type: string; id: string }[] };
      if (Array.isArray(data.layout)) existante = data.layout;
    }
  } catch {
    // Lecture impossible : on préfère ne rien écraser plutôt que deviner.
    // Les tuiles nouvelles seront reprises à la prochaine synchro.
    return;
  }

  const deja = new Set(existante.map((t) => `${t.type}:${t.id}`));
  const ajouts = locales.filter((t) => !deja.has(`${t.type}:${t.id}`));
  if (ajouts.length === 0) return; // rien de neuf à placer

  const res = await fetch(`/api/visits/${visitServerId}/layout`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout: [...existante, ...ajouts] }),
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
    // Visite déjà synchronisée : vérifier qu'elle EXISTE toujours avant de lui
    // envoyer quoi que ce soit. Sinon on retape indéfiniment sur un identifiant
    // mort et rien ne repart jamais.
    let perdus = 0;
    if (visit.serverId && (await visiteEncoreLa(visit.serverId)) === false) {
      perdus = oublierLeServeur(visit);
      await putLocalVisit(visit);
    }

    const serverId = await ensureVisit(visit);
    const titre = visit.exhibition?.trim() || visit.place;

    for (const block of visit.blocks) {
      // Un bloc déjà envoyé est sauté — SAUF s'il lui reste un fichier à
      // joindre. Un module se crée en deux temps (la ligne, puis sa photo sur
      // une sous-route) : si l'envoi s'interrompt entre les deux, un simple
      // `continue` perdrait la photo définitivement, alors que le module, lui,
      // est bien passé. On reprend donc au fichier.
      if (block.serverId && !block.files) continue;

      if (!block.serverId) {
        block.serverId = await pushBlock(serverId, block, titre);
      }
      await pushBlockFiles(serverId, block);
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

    await pushLayout(serverId, visit.blocks, visit.layout);

    visit.syncState = "synced";
    visit.updatedAt = Date.now();
    // Pas un échec — la visite est bien partie — mais l'utilisateur doit
    // savoir que N éléments d'une visite supprimée n'ont pas pu suivre.
    visit.lastError = perdus > 0
      ? `Visite recréée (l'ancienne avait été supprimée). ${perdus} élément${perdus > 1 ? "s" : ""} déjà envoyé${perdus > 1 ? "s" : ""} n'${perdus > 1 ? "ont" : "a"} pas pu être repris — retrouve-les dans la bibliothèque.`
      : undefined;
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

/** Événement émis quand des visites locales viennent d'être envoyées. */
export const VISITS_SYNCED_EVENT = "moodboard-visits-synced";

let autoSyncInstalle = false;

/**
 * Arme la synchro AUTOMATIQUE des visites locales, pour toute l'application.
 *
 * Sans ça, `syncAllLocalVisits` n'était appelé que depuis /hors-ligne : une
 * visite éditée sans réseau ne repartait JAMAIS si l'on rouvrait ensuite
 * l'application connectée, puisqu'on atterrit alors sur les pages normales et
 * que la coquille hors ligne n'est jamais montée. Les modifications restaient
 * en base locale indéfiniment, sans que rien ne l'indique (2026-08-06).
 *
 * Même forme qu'`ensureAutoFlush` de l'outbox : installation unique, au
 * chargement, au retour du réseau, et au retour au premier plan — c'est ce
 * dernier cas qui couvre la réouverture de la PWA.
 */
export function ensureAutoSyncVisits(): void {
  if (autoSyncInstalle || typeof window === "undefined") return;
  autoSyncInstalle = true;

  let enCours = false;
  const tenter = async () => {
    if (enCours) return;
    // Sonde EFFECTIVE : `navigator.onLine` ment sur un wifi captif, et lancer
    // la synchro dans le vide marquerait toutes les visites « en échec ».
    if (!(await serverReachable())) return;
    enCours = true;
    try {
      const { synced } = await syncAllLocalVisits();
      if (synced > 0) {
        window.dispatchEvent(new CustomEvent(VISITS_SYNCED_EVENT, { detail: { synced } }));
      }
    } finally {
      enCours = false;
    }
  };

  window.addEventListener("online", () => void tenter());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void tenter();
  });
  void tenter();
}
