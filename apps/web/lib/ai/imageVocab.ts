// Vocabulaire de l'analyse d'image locale (zero-shot CLIP). Deux familles :
//  · CATEGORY_CONCEPTS — sous-catégories VISUELLEMENT identifiables de la
//    taxonomie (Portrait, Peinture, Affiche…). On ne met QUE celles qu'un
//    modèle peut trancher sur une seule image (on ignore « Long métrage » vs
//    « Court métrage », « Branding », « Campagne »… non décidables visuellement).
//    `category`/`subcategory` = noms EXACTS de la taxonomie → résolus en IDs côté
//    UI via /api/categories. `prompt` = formulation ANGLAISE (CLIP est bien plus
//    fiable en anglais que sur les libellés FR).
//  · TAG_CONCEPTS — lexique transversal (sujet, style, technique, ambiance,
//    couleur dominante) proposé en tags libres.
//
// Les scores CLIP servent au CLASSEMENT (l'utilisateur valide toujours) — pas
// besoin d'un seuil absolu parfait, on montre le top de chaque famille.

export interface CategoryConcept {
  category: string;
  subcategory: string;
  prompt: string;
}

export interface TagConcept {
  label: string;
  prompt: string;
}

export const CATEGORY_CONCEPTS: CategoryConcept[] = [
  // Photographie
  { category: "Photographie", subcategory: "Portrait", prompt: "a portrait photograph of a person's face" },
  { category: "Photographie", subcategory: "Paysage", prompt: "a landscape nature photograph" },
  { category: "Photographie", subcategory: "Architecture", prompt: "an architectural photograph of a building" },
  { category: "Photographie", subcategory: "Still life", prompt: "a still life photograph of arranged objects" },
  { category: "Photographie", subcategory: "Street", prompt: "a candid street photograph of city life" },
  { category: "Photographie", subcategory: "Mode", prompt: "a fashion editorial photograph of a model" },
  // Art contemporain
  { category: "Art contemporain", subcategory: "Peinture", prompt: "a painting" },
  { category: "Art contemporain", subcategory: "Sculpture", prompt: "a sculpture" },
  { category: "Art contemporain", subcategory: "Installation", prompt: "a contemporary art installation in a gallery" },
  { category: "Art contemporain", subcategory: "Dessin", prompt: "a pencil or ink drawing" },
  { category: "Art contemporain", subcategory: "Gravure", prompt: "an engraving or printmaking artwork" },
  { category: "Art contemporain", subcategory: "Céramique", prompt: "a ceramic or pottery object" },
  { category: "Art contemporain", subcategory: "Art numérique", prompt: "digital generative or 3D computer art" },
  // Design graphique
  { category: "Design graphique", subcategory: "Affiche / Poster", prompt: "a graphic design poster" },
  { category: "Design graphique", subcategory: "Typographie", prompt: "a typographic design, text as the main subject" },
  { category: "Design graphique", subcategory: "Design éditorial", prompt: "an editorial magazine layout / print design" },
  { category: "Design graphique", subcategory: "Packaging", prompt: "product packaging design" },
  { category: "Design graphique", subcategory: "UI / Interface", prompt: "a user interface / app screen design" },
  { category: "Design graphique", subcategory: "Cover d'album", prompt: "a music album cover artwork" },
  // Illustration
  { category: "Illustration", subcategory: "Illustration éditoriale", prompt: "an editorial illustration" },
  { category: "Illustration", subcategory: "Concept art", prompt: "concept art for film or games" },
  { category: "Illustration", subcategory: "BD / Bande dessinée", prompt: "a comic book / bande dessinée panel" },
  // Architecture & Espace
  { category: "Architecture & Espace", subcategory: "Architecture", prompt: "a building's exterior architecture" },
  { category: "Architecture & Espace", subcategory: "Intérieur", prompt: "an interior design of a room" },
  { category: "Architecture & Espace", subcategory: "Scénographie", prompt: "a stage set or scenography" },
  { category: "Architecture & Espace", subcategory: "Urbanisme", prompt: "an urban planning / cityscape view" },
  { category: "Architecture & Espace", subcategory: "Paysagisme", prompt: "a designed garden or landscape" },
  // Mode & Textile
  { category: "Mode & Textile", subcategory: "Haute couture", prompt: "a haute couture runway garment" },
  { category: "Mode & Textile", subcategory: "Accessoires", prompt: "a fashion accessory (bag, shoes, jewelry)" },
  { category: "Mode & Textile", subcategory: "Textile", prompt: "a textile pattern or fabric" },
  // Motion Design
  { category: "Motion Design", subcategory: "Animation 3D", prompt: "a 3D rendered animation still" },
  { category: "Motion Design", subcategory: "Motion graphics", prompt: "abstract motion graphics" },
  // Design industriel
  { category: "Design industriel", subcategory: "Product design", prompt: "an industrial product design object" },
  { category: "Design industriel", subcategory: "Mobilier", prompt: "a piece of designer furniture" },
];

// Tags découpés en GROUPES sémantiques. Chaque groupe est classé séparément
// (softmax INTERNE au groupe) → au lieu que « portrait » et « pastel » se
// diluent dans un même softmax géant, chaque dimension (couleur, technique,
// sujet, ambiance, composition) sort SON meilleur candidat. Résultat : des tags
// plus PRÉCIS et plus DIVERS (retour utilisateur 2026-07-19). On propose le
// top 1-2 de chaque groupe au-dessus d'un seuil relatif.
export const TAG_GROUPS: Record<string, TagConcept[]> = {
  couleur: [
    { label: "noir et blanc", prompt: "a black and white monochrome photograph" },
    { label: "coloré", prompt: "a very colorful highly saturated image" },
    { label: "pastel", prompt: "an image in soft pastel colors" },
    { label: "monochrome", prompt: "an image dominated by a single color" },
    { label: "tons chauds", prompt: "an image in warm red orange tones" },
    { label: "tons froids", prompt: "an image in cool blue tones" },
    { label: "sépia", prompt: "a sepia or faded vintage-colored image" },
  ],
  technique: [
    { label: "photographie", prompt: "a photograph" },
    { label: "illustration", prompt: "an illustration or drawing" },
    { label: "peinture", prompt: "a painting with visible brushstrokes" },
    { label: "3D", prompt: "a 3D computer render" },
    { label: "collage", prompt: "a collage of mixed cut-out images" },
    { label: "typographie", prompt: "text and lettering as the main subject" },
    { label: "vectoriel", prompt: "a flat vector graphic design" },
    { label: "argentique", prompt: "an analog film photograph with grain" },
  ],
  composition: [
    { label: "minimaliste", prompt: "a minimalist composition with lots of empty space" },
    { label: "géométrique", prompt: "strong geometric shapes and patterns" },
    { label: "abstrait", prompt: "an abstract image with no recognizable subject" },
    { label: "symétrique", prompt: "a symmetrical, centered composition" },
    { label: "gros plan", prompt: "an extreme close-up of a detail or texture" },
    { label: "motif", prompt: "a repeating pattern or motif" },
    { label: "chargé", prompt: "a busy, dense, maximalist composition" },
  ],
  sujet: [
    { label: "portrait", prompt: "a close-up of a person's face" },
    { label: "personnage", prompt: "one or more people in a scene" },
    { label: "nature", prompt: "plants, flowers or natural landscape" },
    { label: "paysage", prompt: "a wide landscape or scenery" },
    { label: "urbain", prompt: "a city street or urban environment" },
    { label: "architecture", prompt: "a building or architectural structure" },
    { label: "intérieur", prompt: "the interior of a room" },
    { label: "objet", prompt: "a single object or product" },
    { label: "textile", prompt: "fabric, textile or clothing material" },
    { label: "nourriture", prompt: "food or a meal" },
    { label: "animal", prompt: "an animal" },
    { label: "véhicule", prompt: "a car, bike or vehicle" },
    { label: "eau", prompt: "water, sea, ocean or a river" },
    { label: "ciel", prompt: "the sky or clouds" },
  ],
  ambiance: [
    { label: "sombre", prompt: "a dark, low-key, moody atmosphere" },
    { label: "lumineux", prompt: "a bright, high-key, airy atmosphere" },
    { label: "contrasté", prompt: "high contrast dramatic lighting" },
    { label: "doux", prompt: "soft, diffuse, gentle lighting" },
    { label: "nuit", prompt: "a night-time scene" },
    { label: "vintage", prompt: "a retro, vintage, nostalgic aesthetic" },
    { label: "onirique", prompt: "a dreamy, ethereal, surreal mood" },
    { label: "brut", prompt: "a raw, gritty, industrial look" },
  ],
};

// Tous les concepts de tags à plat (mapping prompt→label côté moteur).
export const TAG_CONCEPTS: TagConcept[] = Object.values(TAG_GROUPS).flat();

// ── Liste À PLAT canonique (ordre STABLE) ────────────────────────────────────
// Catégories d'abord, puis les groupes de tags dans l'ordre de TAG_GROUPS. Cet
// ordre EST le contrat entre la génération des embeddings SigLIP (offline) et
// le moteur au runtime : l'embedding d'indice i correspond à flatConcepts()[i].
export type FlatConcept =
  | { kind: "category"; prompt: string; category: string; subcategory: string }
  | { kind: "tag"; prompt: string; group: string; label: string };

export function flatConcepts(): FlatConcept[] {
  const out: FlatConcept[] = [];
  for (const c of CATEGORY_CONCEPTS) out.push({ kind: "category", prompt: c.prompt, category: c.category, subcategory: c.subcategory });
  for (const [group, concepts] of Object.entries(TAG_GROUPS)) {
    for (const t of concepts) out.push({ kind: "tag", prompt: t.prompt, group, label: t.label });
  }
  return out;
}

// Texte réellement encodé par SigLIP (gabarit d'hypothèse intégré).
export function siglipText(prompt: string): string {
  return `This is a photo of ${prompt}.`;
}

// Formulation CLIP : « a photo of X » aide généralement, mais nos prompts sont
// déjà des phrases descriptives → template neutre pour ne pas les dénaturer.
export const HYPOTHESIS_TEMPLATE = "{}";
