// Transformation « scores SigLIP → suggestions ». Plain JS (.mjs) partagé entre
// l'app (imageAnalysis.ts) et le harnais de test Node, pour tester EXACTEMENT la
// logique qui tourne en prod. `scores` = un cosinus par concept, aligné sur
// flatConcepts() (même ordre que les embeddings pré-calculés).
//
// Idée clé pour la PRÉCISION : on normalise les scores de CHAQUE image en
// z-score (écart à la moyenne, en nombre d'écarts-types). Un concept avec un z
// élevé « ressort » nettement — c'est un signal de CONFIANCE adaptatif par image
// (les cosinus SigLIP bruts n'ont pas d'échelle absolue comparable). Les TITRES
// n'utilisent une dimension que si elle est confiante → fini le sujet faux
// (« mobilier ») qui polluait les titres. Les TAGS gardent la variété (top de
// chaque dimension) : l'utilisateur décoche les faux.

import { flatConcepts } from "./imageVocab.data.mjs";

export const MAX_CATEGORIES = 3; // l'utilisateur choisit (ex. Illustration vs BD)
export const MAX_TAGS = 14; // vocabulaire large → on montre le top de beaucoup de dimensions
export const PER_GROUP_KEEP = 2; // jusqu'à 2 tags par dimension
export const MAX_TITLES = 6;
// Seuils de confiance (z-score) par rôle dans le titre, réglés sur les tests
// d'images réelles (2026-07-19) :
//  · SUJET : sert de NOM de tête du titre → exigeant (un sujet doit être
//    clairement présent, sinon on retombe sur la catégorie, plus sûre).
//  · TECHNIQUE en préfixe (« Risographie — … ») : moyennement exigeant (évite
//    un « 3D — … » erroné sur une photo).
//  · QUALIFICATIF (couleur, lumière, style, composition, ambiance) : permissif.
export const Z_SUBJECT = 1.9; // un sujet ne titre l'image que s'il est CLAIREMENT présent (sinon les images graphiques/typo hallucinent « véhicule/oiseau »)
export const Z_TECH = 1.2; // évite « 3D — … » erroné sur une photo
export const Z_LUM = 1.3; // lumière très évocatrice (clair-obscur, néon) mais bruitée → exigeant
export const Z_TYPO = 1.0; // typographie : n'entre au titre que si le texte ressort clairement
export const Z_QUAL = 0.5;

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// Radical grossier (sans accents, 5 lettres) pour dédoublonner « minimaliste »
// (composition) vs « minimalisme » (style), etc.
const stem = (w) => w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "").slice(0, 5);
const stemKey = (t) => t.split(/\s+|—/).map(stem).filter(Boolean).sort().join("|");

function buildTitles(categories, topByGroup) {
  // Meilleur tag d'une dimension SI confiant (z ≥ seuil), sinon undefined.
  const conf = (g, thr) => {
    const t = topByGroup.get(g);
    return t && t.z >= thr ? t.label : undefined;
  };
  const subj = conf("sujet", Z_SUBJECT);
  const col = conf("couleur", Z_QUAL) ?? conf("teinte", Z_QUAL);
  const lum = conf("lumiere", Z_LUM);
  const comp = conf("composition", Z_QUAL);
  const tech = conf("technique", Z_TECH);
  const amb = conf("ambiance", Z_QUAL);
  const styl = conf("style", Z_QUAL);
  const typ = conf("typo", Z_TYPO);
  const sub = categories[0]?.subcategory; // ancre TOUJOURS fiable (classement catégorie robuste)
  const base = subj ?? sub; // sujet CONFIANT en priorité, sinon la sous-catégorie

  const out = [];
  const seen = new Set();
  const push = (s) => {
    if (!s) return;
    const t = cap(s.trim());
    if (t.length < 3) return;
    const k = stemKey(t);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  // Combo « base + qualificatif » — UNIQUEMENT si le qualificatif existe (sinon
  // on obtenait un titre d'un seul mot en doublon). Ordre = du plus évocateur au
  // moins : lumière, couleur, style, composition, ambiance.
  const combo = (q) => q && push(`${base} ${q}`);
  combo(typ); // sur une image typographique, le trait typo mène (« Typographie serif »)
  combo(lum);
  combo(col);
  combo(styl);
  combo(comp);
  combo(amb);
  // Technique en préfixe si distincte de la base.
  if (tech && stem(tech) !== stem(base)) push(`${cap(tech)} — ${base}`);
  // Variante ancrée sur la catégorie quand la base est un sujet (diversité).
  if (subj && sub && sub !== base) push(`${sub} ${lum ?? col ?? styl ?? ""}`);
  // Replis — garantissent toujours ≥ 1 titre.
  push(base);
  push(sub);
  return out.slice(0, MAX_TITLES);
}

/** `scores` = cosinus par concept (ordre flatConcepts()). → {categories, tags, titles}. */
export function mapScores(scores) {
  const flats = flatConcepts();

  // Statistiques de l'image pour le z-score.
  const n = scores.length || 1;
  let sum = 0;
  for (const s of scores) sum += s;
  const mean = sum / n;
  let varSum = 0;
  for (const s of scores) varSum += (s - mean) * (s - mean);
  const std = Math.sqrt(varSum / n) || 1;
  const zOf = (i) => (scores[i] - mean) / std;

  // Catégories : classement SigLIP fiable, l'utilisateur choisit parmi le top.
  const categories = flats
    .map((c, i) => (c.kind === "category" ? { category: c.category, subcategory: c.subcategory, score: scores[i], z: zOf(i) } : null))
    .filter((x) => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CATEGORIES);

  // Tags : top de chaque dimension → variété. Sans seuil ABSOLU (les cosinus
  // SigLIP peuvent être négatifs) : on s'appuie sur le classement, l'utilisateur
  // décoche. On garde le z pour les titres et un tri final par pertinence.
  const byGroup = new Map();
  flats.forEach((c, i) => {
    if (c.kind === "tag") {
      const arr = byGroup.get(c.group) ?? [];
      arr.push({ label: c.label, score: scores[i], z: zOf(i), group: c.group });
      byGroup.set(c.group, arr);
    }
  });
  const topByGroup = new Map(); // dimension → meilleur tag {label, z, score}
  const topTags = [];
  for (const [g, arr] of byGroup) {
    arr.sort((a, b) => b.score - a.score);
    topByGroup.set(g, arr[0]);
    topTags.push(...arr.slice(0, PER_GROUP_KEEP));
  }
  topTags.sort((a, b) => b.score - a.score);
  const tags = topTags.slice(0, MAX_TAGS);

  // GARANTIE TYPO : quand le texte ressort vraiment (z ≥ seuil), on s'assure que
  // le meilleur tag typographique figure dans la liste même s'il est évincé par
  // des tags de style à z plus élevé — la typo est un signal décisif pour l'user.
  const bestTypo = topByGroup.get("typo");
  if (bestTypo && bestTypo.z >= Z_TYPO && !tags.some((t) => t.label === bestTypo.label)) {
    tags[tags.length - 1] = bestTypo; // remplace le tag de plus faible z (liste triée desc.)
    tags.sort((a, b) => b.score - a.score);
  }

  return { categories, tags, titles: buildTitles(categories, topByGroup) };
}
