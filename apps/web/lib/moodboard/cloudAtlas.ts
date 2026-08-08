import { getThumbnailUrl } from "@/lib/storage/urls";

// ATLAS DE TEXTURES.
//
// Une texture WebGL par image, ce serait 370 appels de dessin et autant de
// changements d'état par frame — injouable. Toutes les vignettes sont donc
// peintes dans quelques grandes textures, et chaque quad ne lit que sa case :
// un seul appel de dessin par atlas, soit deux pour une bibliothèque de 500
// images.
//
// 2048² à 128 px la case = 256 images par atlas, 16 Mo en mémoire vidéo. Un
// atlas de 4096² offrirait une meilleure netteté au zoom mais coûterait 64 Mo
// pièce : disproportionné pour une vue d'ensemble où les vignettes font
// quelques dizaines de pixels à l'écran.
export const CELL = 128;
export const ATLAS = 2048;
export const PAR_LIGNE = ATLAS / CELL;          // 16
export const PAR_ATLAS = PAR_LIGNE * PAR_LIGNE; // 256

export interface AtlasResultat {
  /** Un canvas par atlas, prêt à devenir une texture. */
  canvases: HTMLCanvasElement[];
  /** Par image : atlas, décalage UV, et ratio réel (pour ne pas déformer). */
  cases: { atlas: number; u: number; v: number; ratio: number }[];
}

/**
 * Peint les vignettes dans les atlas, par lots.
 *
 * `onProgres` est appelé à chaque lot pour que la scène s'affiche EN COURS de
 * chargement plutôt qu'après : sur 370 images et une connexion moyenne, tout
 * attendre laisserait un écran vide plusieurs secondes.
 *
 * `crossOrigin` est indispensable : sans lui le canvas devient « teinté » et
 * WebGL refuse d'en faire une texture (vérifié contre R2, qui envoie bien les
 * en-têtes nécessaires).
 */
export async function construireAtlas(
  cles: string[],
  onProgres?: (charges: number, total: number) => void,
  signal?: AbortSignal,
): Promise<AtlasResultat> {
  const nbAtlas = Math.max(1, Math.ceil(cles.length / PAR_ATLAS));
  const canvases: HTMLCanvasElement[] = [];
  const ctxs: CanvasRenderingContext2D[] = [];
  for (let i = 0; i < nbAtlas; i++) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = ATLAS;
    canvases.push(cv);
    ctxs.push(cv.getContext("2d")!);
  }

  const cases: AtlasResultat["cases"] = cles.map((_, i) => {
    const atlas = Math.floor(i / PAR_ATLAS);
    const dans = i % PAR_ATLAS;
    return {
      atlas,
      u: (dans % PAR_LIGNE) / PAR_LIGNE,
      v: Math.floor(dans / PAR_LIGNE) / PAR_LIGNE,
      ratio: 1,
    };
  });

  // Concurrence VOLONTAIREMENT BASSE.
  //
  // Le domaine public de R2 étrangle les rafales, et sa réponse d'étranglement
  // ne porte pas d'en-tête CORS : le navigateur signale alors « No
  // Access-Control-Allow-Origin », ce qui fait chercher un problème de CORS là
  // où il n'y en a pas. Avec 12 requêtes simultanées la moitié des vignettes
  // tombait ; à 6, avec une reprise, tout passe (constaté le 2026-08-06).
  const LOT = 6;
  const REPRISES = 2;
  let charges = 0;

  const charger = (i: number, essai: number) =>
    new Promise<boolean>((resolve) => {
      if (signal?.aborted) return resolve(true);
      const im = new Image();
      im.crossOrigin = "anonymous";
      const fin = (ok: boolean) => resolve(ok);
      im.onload = () => {
        const c = cases[i];
        const x = (c.u * ATLAS) | 0;
        const y = (c.v * ATLAS) | 0;
        const r = im.naturalWidth / im.naturalHeight;
        c.ratio = r;
        // L'image REMPLIT sa case (recadrage centré) : la déformer pour
        // l'ajuster serait pire, et laisser des bandes ferait apparaître des
        // bords de case au filtrage.
        const src = r > 1
          ? { sx: (im.naturalWidth - im.naturalHeight) / 2, sy: 0, s: im.naturalHeight }
          : { sx: 0, sy: (im.naturalHeight - im.naturalWidth) / 2, s: im.naturalWidth };
        ctxs[c.atlas].drawImage(im, src.sx, src.sy, src.s, src.s, x, y, CELL, CELL);
        fin(true);
      };
      im.onerror = () => fin(false);
      // VARIANTE DE CACHE DÉDIÉE (`cors=1`).
      //
      // Les vignettes sont d'abord chargées par le site en <img> ordinaires,
      // donc SANS en-tête `Origin`. Le CDN met alors en cache une réponse
      // dépourvue d'`Access-Control-Allow-Origin`, et la sert telle quelle aux
      // requêtes CORS suivantes : l'atlas échouait en bloc alors que R2 envoie
      // bien l'en-tête sur une réponse fraîche (constaté le 2026-08-06).
      //
      // Ce paramètre donne à l'atlas sa propre entrée de cache, jamais
      // demandée autrement qu'avec `Origin` — elle porte donc toujours
      // l'en-tête. Une politique CORS explicite sur le bucket, avec
      // `Vary: Origin`, rendrait ce contournement inutile.
      const base = getThumbnailUrl(cles[i]);
      im.src = base + (base.includes("?") ? "&" : "?") + "cors=1"
        + (essai > 0 ? `&r=${essai}` : "");
    });

  // Une vignette qui échoue est retentée après une pause : l'étranglement est
  // transitoire, et abandonner laisserait un trou définitif dans le nuage.
  const peindre = async (i: number) => {
    for (let essai = 0; essai <= REPRISES; essai++) {
      if (await charger(i, essai)) break;
      if (essai < REPRISES) await new Promise((r) => setTimeout(r, 350 * (essai + 1)));
    }
    charges++;
    onProgres?.(charges, cles.length);
  };

  for (let i = 0; i < cles.length; i += LOT) {
    if (signal?.aborted) break;
    await Promise.all(cles.slice(i, i + LOT).map((_, j) => peindre(i + j)));
  }

  return { canvases, cases };
}
