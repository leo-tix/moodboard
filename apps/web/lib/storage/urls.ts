const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";

// Une clé DÉJÀ absolue est rendue telle quelle.
//
// Hors ligne, un fichier n'a pas encore de clé R2 : il vit en blob dans
// IndexedDB et s'affiche via une URL d'objet (`blob:…`). Ce passe-plat permet
// au carnet hors ligne de réutiliser EXACTEMENT les mêmes composants de tuile
// qu'en ligne — même grille, même rendu — au lieu d'une seconde interface qui
// divergerait (demande utilisateur 2026-08-06 : « l'interface du carnet doit
// être exactement la même hors ligne qu'en ligne »).
function estAbsolue(cle: string): boolean {
  return cle.startsWith("blob:") || cle.startsWith("data:") || cle.startsWith("http");
}

export function getImageUrl(storageKey: string): string {
  return estAbsolue(storageKey) ? storageKey : `${R2_PUBLIC_URL}/${storageKey}`;
}

export function getThumbnailUrl(thumbnailKey: string): string {
  return estAbsolue(thumbnailKey) ? thumbnailKey : `${R2_PUBLIC_URL}/${thumbnailKey}`;
}

// Même construction d'URL publique R2 que getImageUrl — alias dédié pour la
// lisibilité des call-sites audio (VisitAudio.storageKey), pas une nouvelle logique.
export function getAudioUrl(storageKey: string): string {
  return estAbsolue(storageKey) ? storageKey : `${R2_PUBLIC_URL}/${storageKey}`;
}
