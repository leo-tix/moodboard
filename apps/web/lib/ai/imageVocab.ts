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

export const TAG_CONCEPTS: TagConcept[] = [
  // Technique / rendu
  { label: "noir et blanc", prompt: "a black and white monochrome image" },
  { label: "minimaliste", prompt: "a minimalist composition with lots of empty space" },
  { label: "coloré", prompt: "a very colorful, saturated image" },
  { label: "géométrique", prompt: "geometric shapes and patterns" },
  { label: "abstrait", prompt: "an abstract image without recognizable subject" },
  { label: "vintage", prompt: "a vintage retro aesthetic" },
  { label: "collage", prompt: "a collage of mixed images" },
  { label: "texture", prompt: "a close-up of a surface texture or material" },
  { label: "typographie", prompt: "text and lettering as the main element" },
  // Sujet
  { label: "portrait", prompt: "a person's face in close-up" },
  { label: "nature", prompt: "nature, plants or landscape" },
  { label: "urbain", prompt: "an urban city environment" },
  { label: "architecture", prompt: "a building or architecture" },
  { label: "nourriture", prompt: "food or a meal" },
  { label: "animal", prompt: "an animal" },
  { label: "eau", prompt: "water, sea or ocean" },
  // Ambiance / lumière
  { label: "sombre", prompt: "a dark, low-key, moody image" },
  { label: "lumineux", prompt: "a bright, high-key, airy image" },
  { label: "pastel", prompt: "soft pastel colors" },
  { label: "contrasté", prompt: "high contrast dramatic lighting" },
  { label: "nuit", prompt: "a night scene" },
];

// Formulation CLIP : « a photo of X » aide généralement, mais nos prompts sont
// déjà des phrases descriptives → template neutre pour ne pas les dénaturer.
export const HYPOTHESIS_TEMPLATE = "{}";
