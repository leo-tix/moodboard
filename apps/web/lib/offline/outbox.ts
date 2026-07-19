// File d'attente de capture hors ligne ("outbox") — Phase 4 offline-first.
//
// Scénario cible : en visite (musée, wifi instable), l'utilisateur prend des
// photos et dicte des mémos. Sans réseau, on ne perd rien : chaque capture est
// stockée localement dans IndexedDB (le blob est cloné-structuré tel quel) puis
// rejouée automatiquement au retour de la connexion.
//
// ⚠ L'appareil réel de l'utilisateur est un iPhone : l'API Background Sync
// n'existe PAS en PWA iOS. La resync ne peut donc pas reposer dessus — elle est
// déclenchée depuis le contexte de la PAGE sur les événements `online`,
// `visibilitychange` (retour au premier plan) et au chargement. Ces trois
// déclencheurs fonctionnent partout, iOS compris. On ne délègue rien au Service
// Worker (qui devrait de toute façon dupliquer la logique upload+rattachement).

export type OutboxKind = "photo" | "memo";

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  visitId: string;
  blob: Blob;
  filename: string;
  /** Photo : titre par défaut de l'image (= nom de la visite). */
  title?: string;
  /** Mémo : durée en secondes (champ natif de VisitAudio). */
  durationSec?: number;
  /** Mémo : transcription éditée par l'utilisateur, optionnelle. */
  transcript?: string;
  /** Mémo : timings par mot (Whisper) pour le karaoke synchronisé, optionnels. */
  wordTimings?: { word: string; start: number; end: number }[];
  createdAt: number;
  attempts: number;
  lastError?: string;
}

/** Entrée de mise en file : tout sauf les champs gérés en interne. */
export type OutboxInput = Omit<OutboxItem, "id" | "createdAt" | "attempts" | "lastError">;

const DB_NAME = "moodboard-offline";
const STORE = "captures";
const DB_VERSION = 1;
export const OUTBOX_SYNCED_EVENT = "moodboard-outbox-synced";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putItem(item: OutboxItem): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function deleteItem(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function getAllItems(): Promise<OutboxItem[]> {
  const db = await openDb();
  try {
    const items = await new Promise<OutboxItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as OutboxItem[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    return items.sort((a, b) => a.createdAt - b.createdAt);
  } finally {
    db.close();
  }
}

// ── Abonnement (les vues React se re-rendent quand la file change) ──
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* un listener défaillant ne doit pas casser les autres */
    }
  });
}

export async function enqueueCapture(input: OutboxInput): Promise<OutboxItem> {
  const item: OutboxItem = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    attempts: 0,
  };
  await putItem(item);
  notify();
  // Si on est en ligne au moment de la mise en file (ex. échec ponctuel plutôt
  // que hors ligne franc), tenter tout de suite — sinon le prochain déclencheur
  // (online / retour au premier plan) s'en chargera.
  if (typeof navigator === "undefined" || navigator.onLine !== false) {
    void flushOutbox();
  }
  return item;
}

export async function listPending(visitId?: string): Promise<OutboxItem[]> {
  const items = await getAllItems();
  return visitId ? items.filter((i) => i.visitId === visitId) : items;
}

export async function countPending(visitId?: string): Promise<number> {
  return (await listPending(visitId)).length;
}

// ── Rejeu d'une capture contre les mêmes API que le chemin en ligne ──
async function syncItem(item: OutboxItem): Promise<void> {
  if (item.kind === "photo") {
    const fd = new FormData();
    fd.append("file", item.blob, item.filename);
    if (item.title) fd.append("title", item.title);
    const up = await fetch("/api/upload/image", { method: "POST", body: fd });
    const data = (await up.json().catch(() => ({}))) as { inspirationId?: string; error?: string };
    if (!up.ok || !data.inspirationId) {
      throw new Error(data.error ?? `upload ${up.status}`);
    }
    const attach = await fetch(`/api/visits/${item.visitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addInspirationIds: [data.inspirationId] }),
    });
    if (!attach.ok) throw new Error(`attach ${attach.status}`);
  } else {
    const fd = new FormData();
    fd.append("file", item.blob, item.filename);
    fd.append("durationSec", String(item.durationSec ?? 1));
    if (item.transcript) fd.append("transcript", item.transcript);
    if (item.wordTimings?.length) fd.append("wordTimings", JSON.stringify(item.wordTimings));
    const res = await fetch(`/api/visits/${item.visitId}/audio`, { method: "POST", body: fd });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `audio ${res.status}`);
    }
  }
}

// Garde-fou de réentrance : plusieurs déclencheurs (online + visibilitychange +
// enqueue) peuvent se chevaucher, on ne veut pas rejouer deux fois le même item.
let flushing = false;

export async function flushOutbox(): Promise<{ synced: number; failed: number }> {
  if (flushing) return { synced: 0, failed: 0 };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { synced: 0, failed: 0 };
  }
  flushing = true;
  let synced = 0;
  let failed = 0;
  try {
    const items = await getAllItems();
    for (const item of items) {
      try {
        await syncItem(item);
        await deleteItem(item.id);
        synced++;
        notify();
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(OUTBOX_SYNCED_EVENT, { detail: { visitId: item.visitId } }),
          );
        }
      } catch (err) {
        failed++;
        item.attempts += 1;
        item.lastError = err instanceof Error ? err.message.slice(0, 140) : String(err);
        await putItem(item);
        notify();
        // Coupure réseau en plein rejeu : inutile d'insister sur les suivants,
        // le prochain `online` relancera tout.
        if (typeof navigator !== "undefined" && navigator.onLine === false) break;
      }
    }
  } finally {
    flushing = false;
  }
  return { synced, failed };
}

// Installe une seule fois les déclencheurs de resync (idempotent). Appelé au
// montage du hook useOutbox — donc dès qu'une page qui suit la file est visible.
let autoFlushInstalled = false;

export function ensureAutoFlush(): void {
  if (autoFlushInstalled || typeof window === "undefined") return;
  autoFlushInstalled = true;
  window.addEventListener("online", () => void flushOutbox());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushOutbox();
  });
  // Au chargement : rattraper ce qui n'aurait pas été synchronisé lors d'une
  // session précédente fermée hors ligne.
  void flushOutbox();
}
