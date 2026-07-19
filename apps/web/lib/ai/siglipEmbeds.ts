// Embeddings texte SigLIP PRÉ-CALCULÉS du vocabulaire (générés offline, voir le
// commit qui ajoute siglipTextEmbeds.json). Ordre aligné sur flatConcepts().
// Au runtime on n'encode QUE l'image (SiglipVisionModel) et on fait un simple
// produit scalaire avec ces vecteurs → rapide, et pas d'encodeur de texte à
// télécharger. Les lignes sont déjà normalisées (L2).
import embeds from "./siglipTextEmbeds.json";

export const SIGLIP_DIM: number = embeds.dim;
export const SIGLIP_COUNT: number = embeds.count;

let matrix: Float32Array | null = null;
function getMatrix(): Float32Array {
  if (matrix) return matrix;
  const bin = atob(embeds.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  matrix = new Float32Array(bytes.buffer);
  return matrix;
}

/** Cosinus de CHAQUE libellé du vocabulaire avec l'embedding image (longueur DIM). */
export function scoreImageEmbedding(img: ArrayLike<number>): number[] {
  const mat = getMatrix();
  const dim = SIGLIP_DIM;
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += img[i] * img[i];
  norm = Math.sqrt(norm) || 1;
  const out: number[] = new Array(SIGLIP_COUNT);
  for (let c = 0; c < SIGLIP_COUNT; c++) {
    let dot = 0;
    const base = c * dim;
    for (let i = 0; i < dim; i++) dot += img[i] * mat[base + i];
    out[c] = dot / norm; // lignes texte déjà normalisées
  }
  return out;
}
