// Événement partagé "le nombre d'images en triage a changé" — même pattern
// que OUTBOX_SYNCED_EVENT (lib/offline/outbox.ts). TriageClient (page /triage)
// et TriageBadge (pastille permanente dans BottomNav/Sidebar) sont deux
// composants indépendants qui ne se voient pas dans l'arbre React : ce sont
// des événements DOM globaux, pas un contexte, qui les relient pour que la
// pastille se mette à jour dès qu'une décision de triage est prise, au lieu
// de rester figée sur le chiffre lu au montage.
export const TRIAGE_COUNT_CHANGED_EVENT = "moodboard-triage-count-changed";

export function notifyTriageCountChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TRIAGE_COUNT_CHANGED_EVENT));
  }
}
