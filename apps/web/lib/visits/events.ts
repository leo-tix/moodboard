// Événement partagé "la grille d'une visite a peut-être de nouvelles tuiles
// côté serveur" — même pattern que TRIAGE_COUNT_CHANGED_EVENT
// (lib/triage/events.ts) et OUTBOX_SYNCED_EVENT (lib/offline/outbox.ts).
// VisitCaptureFab et VisitJournal ne se voient pas dans l'arbre React : cet
// événement DOM global les relie pour une resynchronisation immédiate via
// `fetch` (jamais soumis au cache du routeur Next.js, contrairement à
// router.refresh() — voir le commentaire dans VisitJournal.tsx).
export const VISIT_TILES_DIRTY_EVENT = "moodboard-visit-tiles-dirty";

export function notifyVisitTilesDirty(visitId: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(VISIT_TILES_DIRTY_EVENT, { detail: { visitId } }));
  }
}
