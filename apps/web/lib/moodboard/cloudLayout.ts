import type { CloudImage } from "@/app/api/library/cloud/route";

export type CloudMode = "tags" | "couleur" | "categorie" | "annee";

export interface CloudPoint {
  x: number;
  y: number;
  z: number;
}

/** Repère visuel d'un mode (nom de groupe ou graduation), placé dans la scène. */
export interface CloudLabel {
  texte: string;
  x: number;
  y: number;
  z: number;
}

export interface CloudLayout {
  points: CloudPoint[];
  labels: CloudLabel[];
}

const RAYON = 60;

// Hachage stable d'une chaîne → direction unitaire.
//
// Le même tag donne TOUJOURS la même direction, d'une session à l'autre et
// d'un appareil à l'autre. Sans ça, le nuage se réorganiserait à chaque
// ouverture et on ne pourrait rien y mémoriser spatialement.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function direction(cle: string): CloudPoint {
  const a = hash(cle);
  const b = hash(cle + "#");
  // Répartition UNIFORME sur la sphère : tirer directement deux angles
  // tasserait les directions aux pôles.
  const u = (a % 10000) / 10000;
  const v = (b % 10000) / 10000;
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  return {
    x: Math.sin(phi) * Math.cos(theta),
    y: Math.cos(phi),
    z: Math.sin(phi) * Math.sin(theta),
  };
}

function alea(cle: string, sel: string): number {
  return (hash(cle + sel) % 10000) / 10000;
}

// ── Mode sémantique : nuage continu ─────────────────────────────────────────
//
// Chaque TAG reçoit une direction fixe ; une image se place à la moyenne des
// directions de ses tags. Deux images qui partagent des tags tombent donc
// naturellement près l'une de l'autre, et plus elles en partagent, plus elles
// sont proches — sans avoir à désigner un tag « principal », et sans qu'aucun
// groupe ne soit dessiné explicitement.
//
// Préféré à un placement par forces : celui-ci coûte O(n²) par itération,
// converge différemment à chaque exécution, et produirait une carte qu'on ne
// peut pas mémoriser. Ici c'est O(n) et parfaitement reproductible.
function dispositionTags(images: CloudImage[]): CloudLayout {
  const points = images.map((img) => {
    if (img.g.length === 0) {
      // Sans tag, une image n'a aucune raison d'être quelque part : on la met
      // en périphérie plutôt qu'au centre, où elle brouillerait les voisinages.
      const d = direction(img.id);
      const r = RAYON * 1.35;
      return { x: d.x * r, y: d.y * r, z: d.z * r };
    }
    let x = 0, y = 0, z = 0;
    for (const t of img.g) {
      const d = direction(t);
      x += d.x; y += d.y; z += d.z;
    }
    const n = Math.hypot(x, y, z) || 1;
    // Le rayon varie un peu selon l'image pour éviter que toutes celles qui
    // ont exactement les mêmes tags ne se superposent en un seul point.
    const r = RAYON * (0.55 + 0.5 * alea(img.id, "r"));
    return { x: (x / n) * r, y: (y / n) * r, z: (z / n) * r };
  });

  // Étiquettes : les tags les plus portés, posés dans leur direction.
  const compte = new Map<string, number>();
  for (const img of images) for (const t of img.g) compte.set(t, (compte.get(t) ?? 0) + 1);
  const labels = [...compte.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([t]) => {
      const d = direction(t);
      const r = RAYON * 1.55;
      return { texte: t, x: d.x * r, y: d.y * r, z: d.z * r };
    });

  return { points: espacer(points), labels };
}

// ── Mode couleur : solide des couleurs ──────────────────────────────────────
// Teinte → angle autour de l'axe vertical, saturation → distance à l'axe,
// luminosité → hauteur. C'est la représentation habituelle d'un espace TSL,
// donc immédiatement lisible : les gris au centre, les couleurs vives au bord.
function dispositionCouleur(images: CloudImage[]): CloudLayout {
  const points = images.map((img) => {
    const { h, s, l } = hexToHsl(img.col ?? "#808080");
    const angle = h * 2 * Math.PI;
    const rayon = RAYON * (0.12 + 0.95 * s);
    const hauteur = (l - 0.5) * 2 * RAYON;
    // Léger désordre : sans lui, les images d'une même dominante forment une
    // pile parfaitement alignée et invisible de côté.
    const j = (c: string) => (alea(img.id, c) - 0.5) * RAYON * 0.12;
    return {
      x: Math.cos(angle) * rayon + j("x"),
      y: hauteur + j("y"),
      z: Math.sin(angle) * rayon + j("z"),
    };
  });

  const labels = [
    ["Rouge", 0], ["Jaune", 1 / 6], ["Vert", 2 / 6],
    ["Cyan", 3 / 6], ["Bleu", 4 / 6], ["Magenta", 5 / 6],
  ].map(([texte, h]) => {
    const a = (h as number) * 2 * Math.PI;
    return { texte: texte as string, x: Math.cos(a) * RAYON * 1.3, y: 0, z: Math.sin(a) * RAYON * 1.3 };
  });

  return { points, labels };
}

// ── Mode catégorie : amas séparés ───────────────────────────────────────────
function dispositionCategorie(images: CloudImage[]): CloudLayout {
  const cats = [...new Set(images.map((i) => i.c ?? "Sans catégorie"))].sort();
  const points = images.map((img) => {
    const cat = img.c ?? "Sans catégorie";
    const d = direction("cat:" + cat);
    const centre = { x: d.x * RAYON, y: d.y * RAYON, z: d.z * RAYON };
    const local = direction(img.id);
    const r = RAYON * 0.34 * Math.cbrt(alea(img.id, "d"));   // remplissage homogène de la boule
    return { x: centre.x + local.x * r, y: centre.y + local.y * r, z: centre.z + local.z * r };
  });
  const labels = cats.map((cat) => {
    const d = direction("cat:" + cat);
    const r = RAYON * 1.45;
    return { texte: cat, x: d.x * r, y: d.y * r, z: d.z * r };
  });
  return { points, labels };
}

// ── Mode année : colonnes chronologiques ────────────────────────────────────
// Une année par tranche de hauteur, les images réparties en anneau autour de
// l'axe. Les images sans année sont regroupées sous la frise, pas mélangées.
function dispositionAnnee(images: CloudImage[]): CloudLayout {
  const annees = [...new Set(images.map((i) => i.y).filter((y): y is number => y != null))].sort((a, b) => a - b);
  const min = annees[0] ?? 0;
  const max = annees[annees.length - 1] ?? 1;
  const etendue = Math.max(1, max - min);
  const hauteurDe = (y: number) => ((y - min) / etendue - 0.5) * 2.2 * RAYON;

  const parAnnee = new Map<number | null, number>();
  const points = images.map((img) => {
    const n = parAnnee.get(img.y) ?? 0;
    parAnnee.set(img.y, n + 1);
    if (img.y == null) {
      const d = direction(img.id);
      return { x: d.x * RAYON * 0.7, y: -1.6 * RAYON, z: d.z * RAYON * 0.7 };
    }
    // Spirale : l'anneau s'élargit avec le nombre d'images de l'année, sinon
    // les années chargées se chevauchent et les rares flottent.
    const angle = n * 2.399963;                    // angle d'or → répartition régulière
    const r = RAYON * (0.25 + 0.06 * Math.sqrt(n));
    return { x: Math.cos(angle) * r, y: hauteurDe(img.y), z: Math.sin(angle) * r };
  });

  const pas = Math.max(1, Math.round(etendue / 8));
  const labels: CloudLabel[] = [];
  for (let y = min; y <= max; y += pas) {
    labels.push({ texte: String(y), x: RAYON * 0.9, y: hauteurDe(y), z: 0 });
  }
  return { points, labels };
}

// Écarte les points trop proches — quelques passes suffisent à rendre les
// vignettes distinctes sans déformer la structure d'ensemble.
function espacer(points: CloudPoint[], passes = 3, minDist = 4.5): CloudPoint[] {
  const p = points.map((q) => ({ ...q }));
  const min2 = minDist * minDist;
  // Grille de voisinage : comparer toutes les paires coûterait O(n²) à chaque
  // passe (250 000 comparaisons pour 500 images, × 3 passes).
  for (let passe = 0; passe < passes; passe++) {
    const cellule = minDist;
    const grille = new Map<string, number[]>();
    const cle = (q: CloudPoint) =>
      `${Math.floor(q.x / cellule)},${Math.floor(q.y / cellule)},${Math.floor(q.z / cellule)}`;
    p.forEach((q, i) => {
      const k = cle(q);
      const l = grille.get(k);
      if (l) l.push(i); else grille.set(k, [i]);
    });
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const cx = Math.floor(a.x / cellule), cy = Math.floor(a.y / cellule), cz = Math.floor(a.z / cellule);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const j of grille.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          if (j <= i) continue;
          const b = p[j];
          const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z;
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 >= min2 || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const pousse = (minDist - d) / 2;
          const ux = ex / d, uy = ey / d, uz = ez / d;
          a.x -= ux * pousse; a.y -= uy * pousse; a.z -= uz * pousse;
          b.x += ux * pousse; b.y += uy * pousse; b.z += uz * pousse;
        }
      }
    }
  }
  return p;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { h: 0, s: 0, l: 0.5 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

export function calculerDisposition(images: CloudImage[], mode: CloudMode): CloudLayout {
  switch (mode) {
    case "couleur": return dispositionCouleur(images);
    case "categorie": return dispositionCategorie(images);
    case "annee": return dispositionAnnee(images);
    default: return dispositionTags(images);
  }
}

export const MODES: { id: CloudMode; label: string }[] = [
  { id: "tags", label: "Sémantique" },
  { id: "couleur", label: "Couleur" },
  { id: "categorie", label: "Catégorie" },
  { id: "annee", label: "Année" },
];
