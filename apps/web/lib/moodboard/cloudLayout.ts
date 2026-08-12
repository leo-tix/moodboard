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

/**
 * Teinte REPRÉSENTATIVE d'une image, et non sa dominante.
 *
 * La dominante d'un visuel est presque toujours son fond — noir ou blanc sur
 * la majorité d'une bibliothèque de design. Trier là-dessus tassait tout au
 * même endroit : pas de teinte (angle nul), pas de saturation (au centre),
 * luminosité nulle (tout en bas). On choisit donc dans la palette la couleur
 * la plus CHROMATIQUE — saturée sans être ni noire ni cramée.
 */
function teinteRepresentative(palette: string[]): { h: number; s: number; l: number } | null {
  let meilleure: { h: number; s: number; l: number } | null = null;
  let meilleurScore = -1;
  for (const hex of palette) {
    const c = hexToHsl(hex);
    // Pénalise les extrêmes de luminosité : un noir « saturé » n'existe pas
    // visuellement, et un blanc cassé ne dit rien d'une teinte.
    const utile = 1 - Math.abs(c.l - 0.5) * 1.6;
    const score = c.s * Math.max(0, utile);
    if (score > meilleurScore) { meilleurScore = score; meilleure = c; }
  }
  // Palette entièrement neutre : l'image est vraiment achromatique.
  return meilleurScore > 0.04 ? meilleure : (palette.length ? hexToHsl(palette[0]) : null);
}

// ── Mode couleur : solide des couleurs ──────────────────────────────────────
// Teinte → angle autour de l'axe vertical, saturation → distance à l'axe,
// luminosité → hauteur. Les gris au centre, les couleurs vives au bord.
function dispositionCouleur(images: CloudImage[]): CloudLayout {
  const teintes = images.map((img) => teinteRepresentative(img.col) ?? { h: 0, s: 0, l: 0.5 });

  // Hauteur par RANG de luminosité, pas par valeur.
  //
  // Mesuré sur la bibliothèque : la luminosité moyenne est de 0,14 — une
  // échelle par valeur empile donc tout dans le tiers inférieur, quelle que
  // soit la correction appliquée. Le classement, lui, occupe toujours la
  // hauteur entière. Même raisonnement que pour la frise des années.
  const ordre = teintes.map((c, i) => ({ i, l: c.l })).sort((a, b) => a.l - b.l);
  const rangL = new Array<number>(teintes.length);
  ordre.forEach((o, r) => { rangL[o.i] = teintes.length > 1 ? r / (teintes.length - 1) : 0.5; });

  const points = images.map((img, i) => {
    const c = teintes[i];
    const angle = c.h * 2 * Math.PI;
    const rayon = RAYON * (0.15 + 1.05 * c.s);
    const hauteur = (rangL[i] - 0.5) * 2.2 * RAYON;
    // Léger désordre : sans lui, les images d'une même teinte forment une
    // pile parfaitement alignée et invisible de côté.
    const j = (k: string) => (alea(img.id, k) - 0.5) * RAYON * 0.16;
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

  return { points: espacer(points), labels };
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
  return { points: espacer(points), labels };
}

// ── Mode année : frise par RANG, pas par valeur ─────────────────────────────
//
// Une échelle linéaire de 1600 à 2024 est inexploitable ici : la bibliothèque
// est massivement contemporaine, donc tout s'empilait sur la graduation 2024
// pendant que quatre siècles restaient vides. On classe donc les années
// PRÉSENTES par rang — chaque année peuplée reçoit la même tranche de hauteur,
// quel que soit l'écart chronologique avec la suivante.
function dispositionAnnee(images: CloudImage[]): CloudLayout {
  const annees = [...new Set(images.map((i) => i.y).filter((y): y is number => y != null))]
    .sort((a, b) => a - b);
  const rang = new Map(annees.map((y, i) => [y, i]));
  const der = Math.max(1, annees.length - 1);
  // Assez haut pour que deux bandes voisines ne se mélangent pas : avec 18
  // années, 2,4 rayons ne laissaient que 8 unités d'écart pour des vignettes
  // qui en font 7.
  const HAUT = 3.8 * RAYON;
  const hauteurDe = (y: number) => ((rang.get(y)! / der) - 0.5) * HAUT;

  // Combien d'images par année : le rayon de l'anneau doit s'adapter, sinon
  // une année chargée se recouvre entièrement pendant qu'une année rare flotte.
  const parAnnee = new Map<number, number>();
  for (const i of images) if (i.y != null) parAnnee.set(i.y, (parAnnee.get(i.y) ?? 0) + 1);

  const sansDate = images.filter((i) => i.y == null).length;
  const vus = new Map<number | null, number>();
  const points = images.map((img) => {
    const n = vus.get(img.y) ?? 0;
    vus.set(img.y, n + 1);
    if (img.y == null) {
      // Sans date : un disque à part, nettement SOUS la frise, pour ne pas
      // laisser croire à une position chronologique.
      // Plus de la moitié de la bibliothèque n'a pas de date : ce disque doit
      // être dimensionné pour elles, sinon il se recouvre entièrement.
      const d = direction(img.id);
      const r = 6 + RAYON * 0.2 * Math.sqrt(Math.max(1, sansDate)) * Math.sqrt(alea(img.id, "u"));
      return { x: d.x * r, y: -HAUT * 0.95, z: d.z * r };
    }
    const total = parAnnee.get(img.y) ?? 1;
    // Disque en spirale de Vogel, de rayon PROPORTIONNEL à l'effectif : une
    // année à 101 images et une année à 1 image ne peuvent pas occuper le même
    // disque. La racine carrée maintient une densité constante.
    const angle = n * 2.399963;
    const rMax = RAYON * 0.22 * Math.sqrt(total);
    const r = 4 + rMax * Math.sqrt((n + 0.5) / total);
    return {
      x: Math.cos(angle) * r,
      // Désordre vertical limité au tiers de l'écart entre bandes : au-delà,
      // une image se retrouve visuellement dans l'année voisine.
      y: hauteurDe(img.y) + (alea(img.id, "h") - 0.5) * (HAUT / Math.max(6, der)) * 0.33,
      z: Math.sin(angle) * r,
    };
  });

  // Une graduation tous les N rangs, en affichant l'année réelle.
  const pas = Math.max(1, Math.ceil(annees.length / 8));
  const labels: CloudLabel[] = [];
  for (let i = 0; i < annees.length; i += pas) {
    labels.push({ texte: String(annees[i]), x: RAYON * 1.05, y: hauteurDe(annees[i]), z: 0 });
  }
  if (images.some((i) => i.y == null)) {
    labels.push({ texte: "Sans date", x: RAYON * 1.05, y: -HAUT * 0.78, z: 0 });
  }
  return { points: espacer(points), labels };
}

// Écarte les points trop proches — quelques passes suffisent à rendre les
// vignettes distinctes sans déformer la structure d'ensemble.
// `minDist` doit dépasser la taille d'une vignette (7 unités par défaut),
// sinon deux images se recouvrent et l'une devient impossible à viser.
function espacer(points: CloudPoint[], passes = 5, minDist = 9): CloudPoint[] {
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
