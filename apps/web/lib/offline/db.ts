// Base IndexedDB partagée du mode hors ligne.
//
// Deux magasins, ouverts par la MÊME connexion pour éviter les conflits de
// version entre modules (IndexedDB refuse une ouverture en version inférieure,
// et bloque une montée de version tant qu'une autre connexion est ouverte) :
//
//  · `captures` — file d'attente des blobs à renvoyer (lib/offline/outbox.ts).
//    Existe depuis la v1, inchangé.
//  · `visits`   — visites créées ou consultées HORS LIGNE, avec leurs blocs
//    (lib/offline/localVisits.ts). Ajouté en v2.
//
// Voir docs/carnet-hors-ligne.md §5.

export const DB_NAME = "moodboard-offline";
export const DB_VERSION = 2;
export const STORE_CAPTURES = "captures";
export const STORE_VISITS = "visits";

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Migration additive : on ne touche jamais aux données déjà présentes.
      if (!db.objectStoreNames.contains(STORE_CAPTURES)) {
        db.createObjectStore(STORE_CAPTURES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_VISITS)) {
        db.createObjectStore(STORE_VISITS, { keyPath: "localId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Exécute une transaction et referme la connexion, succès comme échec. */
export async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest | void,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = run(tx.objectStore(store));
      let out: T | undefined;
      if (req) req.onsuccess = () => { out = req.result as T; };
      tx.oncomplete = () => resolve(out as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
