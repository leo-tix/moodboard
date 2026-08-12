import { getThumbnailUrl } from "@/lib/storage/urls";

// ATLAS DE TEXTURES.
//
// Une texture WebGL par image, ce serait 370 appels de dessin et autant de
// changements d'état par frame — injouable. Toutes les vignettes sont donc
// peintes dans quelques grandes textures, et chaque quad ne lit que sa case :
// un seul appel de dessin par atlas.
//
// 2048² à 128 px la case = 256 images par atlas, 16 Mo en mémoire vidéo. Un
// atlas de 4096² serait plus net au zoom mais coûterait 64 Mo pièce.
export const CELL = 128;
export const ATLAS = 2048;
export const PAR_LIGNE = ATLAS / CELL;          // 16
export const PAR_ATLAS = PAR_LIGNE * PAR_LIGNE; // 256

export interface Atlas {
  /** Canvas VIDES, disponibles immédiatement : la scène se monte sans attendre. */
  canvases: HTMLCanvasElement[];
  /** Par image : atlas, décalage UV, et RATIO réel une fois chargée. */
  cases: { atlas: number; u: number; v: number; ratio: number }[];
  /**
   * Lance le remplissage. `onLot` est appelé après chaque paquet avec les
   * atlas modifiés, pour que l'appelant rafraîchisse SES textures.
   */
  remplir: (
    onLot: (atlasModifies: number[], indexCharges: number[], charges: number, total: number) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
}

// Concurrence VOLONTAIREMENT BASSE.
//
// Le domaine public de R2 étrangle les rafales, et sa réponse d'étranglement
// ne porte pas d'en-tête CORS : le navigateur signale alors « No
// Access-Control-Allow-Origin », ce qui fait chercher un problème de CORS là
// où il n'y en a pas. À 12 requêtes simultanées la moitié des vignettes
// tombait ; à 6, avec reprise, tout passe (constaté le 2026-08-06).
const LOT = 6;
const REPRISES = 2;

/**
 * Prépare les atlas SANS rien charger, puis laisse l'appelant déclencher le
 * remplissage.
 *
 * La version précédente attendait la dernière vignette avant de rendre la
 * main : le nuage restait vide plusieurs secondes derrière un compteur qui
 * défilait tout seul. Ici les canvas existent tout de suite, la scène
 * s'affiche, et les images apparaissent au fur et à mesure.
 */
export function preparerAtlas(cles: string[]): Atlas {
  const nbAtlas = Math.max(1, Math.ceil(cles.length / PAR_ATLAS));
  const canvases: HTMLCanvasElement[] = [];
  const ctxs: CanvasRenderingContext2D[] = [];
  for (let i = 0; i < nbAtlas; i++) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = ATLAS;
    canvases.push(cv);
    ctxs.push(cv.getContext("2d")!);
  }

  const cases = cles.map((_, i) => {
    const atlas = Math.floor(i / PAR_ATLAS);
    const dans = i % PAR_ATLAS;
    return {
      atlas,
      u: (dans % PAR_LIGNE) / PAR_LIGNE,
      v: Math.floor(dans / PAR_LIGNE) / PAR_LIGNE,
      ratio: 1,
    };
  });

  const charger = (i: number, essai: number) =>
    new Promise<boolean>((resolve) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => {
        const c = cases[i];
        const x = (c.u * ATLAS) | 0;
        const y = (c.v * ATLAS) | 0;
        // L'image est ÉTIRÉE dans sa case carrée, et le quad est ensuite mis
        // au bon format : rien n'est rogné, aucune case n'est gaspillée en
        // bandes transparentes, et la déformation s'annule exactement.
        // La version précédente recadrait au carré — donc coupait les
        // panoramiques et les portraits (signalé le 2026-08-06).
        c.ratio = im.naturalWidth / Math.max(1, im.naturalHeight);
        try { ctxs[c.atlas].drawImage(im, 0, 0, im.naturalWidth, im.naturalHeight, x, y, CELL, CELL); }
        catch { return resolve(false); }
        resolve(true);
      };
      im.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 12000);
      // VARIANTE DE CACHE DÉDIÉE. Les vignettes sont d'abord chargées par le
      // site en <img> ordinaires, donc sans en-tête `Origin` ; le CDN met en
      // cache une réponse sans `Access-Control-Allow-Origin` et la ressert aux
      // requêtes CORS. Ce paramètre donne à l'atlas sa propre entrée, jamais
      // demandée autrement qu'avec `Origin`.
      const base = getThumbnailUrl(cles[i]);
      im.src = base + (base.includes("?") ? "&" : "?") + "cors=1" + (essai ? `&r=${essai}` : "");
    });

  const remplir: Atlas["remplir"] = async (onLot, signal) => {
    let charges = 0;
    for (let i = 0; i < cles.length; i += LOT) {
      if (signal?.aborted) return;
      const tranche = cles.slice(i, i + LOT);
      const touches = new Set<number>();
      const reussis: number[] = [];
      await Promise.all(
        tranche.map(async (_, j) => {
          const idx = i + j;
          for (let e = 0; e <= REPRISES; e++) {
            if (await charger(idx, e)) { touches.add(cases[idx].atlas); reussis.push(idx); break; }
            // L'étranglement est transitoire : abandonner laisserait un trou
            // définitif dans le nuage.
            if (e < REPRISES) await new Promise((r) => setTimeout(r, 350 * (e + 1)));
          }
          charges++;
        }),
      );
      if (!signal?.aborted) onLot([...touches], reussis, charges, cles.length);
    }
  };

  return { canvases, cases, remplir };
}
