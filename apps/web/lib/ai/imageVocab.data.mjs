// SOURCE DE VÉRITÉ UNIQUE du vocabulaire d'analyse d'image (zero-shot SigLIP).
// Plain JS (.mjs) pour être importé À LA FOIS par l'app (imageVocab.ts, typé) ET
// par des scripts Node hors bundler (générateur d'embeddings, harnais de test).
// C'est ce partage qui garantit l'alignement embeddings↔runtime : le générateur
// et le moteur lisent EXACTEMENT le même flatConcepts().
//
// Deux familles :
//  · CATEGORY_CONCEPTS — sous-catégories VISUELLEMENT identifiables de la
//    taxonomie. `category`/`subcategory` = noms EXACTS de la taxonomie (résolus
//    en IDs côté UI). `prompt` = formulation ANGLAISE (SigLIP y est bien plus
//    fiable qu'en français).
//  · TAG_GROUPS — lexique transversal découpé en DIMENSIONS (couleur, technique,
//    sujet, style…). Chaque dimension est classée séparément → chacune sort son
//    meilleur candidat. Vocabulaire volontairement très large (variété demandée),
//    couvrant photo / illustration-BD / design / motion-3D / mode / archi /
//    œuvres de musée. Dimensions VISUELLES (couleur, teinte, sujet, matière,
//    cadrage, technique) fiables ; dimensions ABSTRAITES (ambiance, style,
//    époque) indicatives — l'utilisateur décoche ce qui est faux.

export const CATEGORY_CONCEPTS = [
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

export const TAG_GROUPS = {
  couleur: [
    { label: "noir et blanc", prompt: "a black and white monochrome image" },
    { label: "coloré", prompt: "a very colorful highly saturated image" },
    { label: "pastel", prompt: "an image in soft pastel colors" },
    { label: "monochrome", prompt: "an image dominated by a single color" },
    { label: "désaturé", prompt: "a desaturated, muted, washed-out image" },
    { label: "fluo", prompt: "vivid fluorescent neon colors" },
    { label: "tons chauds", prompt: "an image in warm red and orange tones" },
    { label: "tons froids", prompt: "an image in cool blue and green tones" },
    { label: "terreux", prompt: "earthy natural brown and ochre tones" },
    { label: "doré / métallique", prompt: "gold, metallic, shiny reflective surfaces" },
    { label: "bicolore", prompt: "an image using only two contrasting colors" },
  ],
  teinte: [
    { label: "rouge", prompt: "a predominantly red image" },
    { label: "bleu", prompt: "a predominantly blue image" },
    { label: "vert", prompt: "a predominantly green image" },
    { label: "jaune", prompt: "a predominantly yellow image" },
    { label: "orange", prompt: "a predominantly orange image" },
    { label: "rose", prompt: "a predominantly pink image" },
    { label: "violet", prompt: "a predominantly purple violet image" },
    { label: "turquoise", prompt: "a predominantly teal turquoise image" },
    { label: "brun", prompt: "a predominantly brown image" },
    { label: "beige", prompt: "a predominantly beige and cream image" },
    { label: "gris", prompt: "a predominantly grey image" },
    { label: "terracotta", prompt: "a predominantly terracotta rust orange-brown image" },
  ],
  technique: [
    { label: "photographie", prompt: "a photograph" },
    { label: "illustration", prompt: "an illustration or drawing" },
    { label: "peinture", prompt: "a painting with visible brushstrokes" },
    { label: "dessin", prompt: "a pencil or ink line drawing" },
    { label: "aquarelle", prompt: "a watercolor painting" },
    { label: "encre", prompt: "a black ink drawing" },
    { label: "gouache", prompt: "a gouache painting with flat opaque colors" },
    { label: "huile", prompt: "an oil painting" },
    { label: "acrylique", prompt: "an acrylic painting" },
    { label: "pastel sec", prompt: "a soft chalk pastel drawing" },
    { label: "fusain", prompt: "a charcoal drawing" },
    { label: "gravure", prompt: "an engraving or etching print" },
    { label: "sérigraphie", prompt: "a screen-printed silkscreen poster" },
    { label: "risographie", prompt: "a risograph print with grainy overlapping inks" },
    { label: "linogravure", prompt: "a linocut or woodcut print" },
    { label: "collage", prompt: "a collage of cut-out images" },
    { label: "photomontage", prompt: "a digital photomontage" },
    { label: "3D", prompt: "a 3D computer render" },
    { label: "vectoriel", prompt: "a flat vector graphic" },
    { label: "pixel art", prompt: "pixel art, low-resolution retro game graphics" },
    { label: "typographie", prompt: "text and lettering as the main subject" },
    { label: "argentique", prompt: "an analog film photograph with grain" },
  ],
  composition: [
    { label: "minimaliste", prompt: "a minimalist composition with lots of empty space" },
    { label: "chargé", prompt: "a busy, dense, maximalist composition" },
    { label: "géométrique", prompt: "strong geometric shapes" },
    { label: "abstrait", prompt: "an abstract image with no recognizable subject" },
    { label: "symétrique", prompt: "a symmetrical, centered composition" },
    { label: "asymétrique", prompt: "an off-center asymmetrical composition" },
    { label: "motif", prompt: "a repeating pattern or motif" },
    { label: "grille", prompt: "a grid-based layout" },
    { label: "diagonale", prompt: "strong diagonal lines and dynamic angles" },
    { label: "superposition", prompt: "layered overlapping elements" },
    { label: "organique", prompt: "flowing organic curved shapes" },
    { label: "vue d'ensemble", prompt: "a wide overall view of a whole scene" },
  ],
  cadrage: [
    { label: "gros plan", prompt: "an extreme close-up of a detail" },
    { label: "plan large", prompt: "a wide-angle shot of a large scene" },
    { label: "macro", prompt: "an extreme macro close-up photograph" },
    { label: "vue aérienne", prompt: "an aerial top-down drone view" },
    { label: "contre-plongée", prompt: "a low-angle shot looking upward" },
    { label: "plongée", prompt: "a high-angle shot looking downward" },
    { label: "panoramique", prompt: "a wide panoramic view" },
    { label: "flou / bokeh", prompt: "a blurry image with shallow depth of field and bokeh" },
    { label: "contre-jour", prompt: "a backlit silhouette against bright light" },
  ],
  sujet: [
    { label: "portrait", prompt: "a close-up of a person's face" },
    { label: "personnage", prompt: "one or more people in a scene" },
    { label: "foule", prompt: "a large crowd of people" },
    { label: "silhouette", prompt: "a dark silhouette of a figure" },
    { label: "mains", prompt: "a close-up of hands" },
    { label: "nu", prompt: "a nude human body figure" },
    { label: "animal", prompt: "an animal" },
    { label: "oiseau", prompt: "a bird" },
    { label: "plante / fleur", prompt: "plants or flowers" },
    { label: "nature", prompt: "wild nature and vegetation" },
    { label: "paysage", prompt: "a wide landscape or scenery" },
    { label: "montagne", prompt: "mountains" },
    { label: "mer", prompt: "the sea or ocean" },
    { label: "forêt", prompt: "a forest" },
    { label: "désert", prompt: "a desert" },
    { label: "ciel", prompt: "the sky or clouds" },
    { label: "ville", prompt: "a city or urban environment" },
    { label: "rue", prompt: "a street scene" },
    { label: "architecture", prompt: "a building or architectural structure" },
    { label: "intérieur", prompt: "the interior of a room" },
    { label: "ruine", prompt: "old ruins or a derelict place" },
    { label: "objet", prompt: "a single object" },
    { label: "produit", prompt: "a commercial product shot" },
    { label: "nourriture", prompt: "food or a meal" },
    { label: "mobilier", prompt: "furniture" },
    { label: "véhicule", prompt: "a car, motorbike or vehicle" },
    { label: "mode", prompt: "fashion clothing on a person" },
    { label: "textile", prompt: "fabric or textile material" },
    { label: "machine", prompt: "machinery or mechanical parts" },
    { label: "nature morte", prompt: "a still life of arranged objects" },
    { label: "sculpture", prompt: "a sculpture or statue" },
  ],
  matiere: [
    { label: "papier", prompt: "a paper surface texture" },
    { label: "métal", prompt: "a metal surface" },
    { label: "verre", prompt: "glass or a transparent surface" },
    { label: "bois", prompt: "a wooden surface" },
    { label: "tissu", prompt: "fabric cloth texture" },
    { label: "béton", prompt: "a concrete surface" },
    { label: "marbre", prompt: "a marble surface" },
    { label: "pierre", prompt: "a stone or rock surface" },
    { label: "plastique", prompt: "a glossy plastic surface" },
    { label: "liquide", prompt: "liquid, water or fluid" },
    { label: "fumée", prompt: "smoke or fog" },
    { label: "rouille", prompt: "a rusty weathered metal surface" },
    { label: "cuir", prompt: "a leather surface" },
    { label: "sable", prompt: "sand" },
    { label: "grain / texture", prompt: "a heavily textured grainy surface" },
  ],
  lumiere: [
    { label: "sombre", prompt: "a dark low-key image" },
    { label: "lumineux", prompt: "a bright high-key airy image" },
    { label: "contrasté", prompt: "high contrast dramatic lighting" },
    { label: "doux", prompt: "soft diffuse gentle lighting" },
    { label: "clair-obscur", prompt: "dramatic chiaroscuro light and shadow" },
    { label: "nuit", prompt: "a night-time scene" },
    { label: "lumière naturelle", prompt: "soft natural daylight" },
    { label: "néon", prompt: "glowing neon light" },
    { label: "brumeux", prompt: "a hazy, foggy, misty atmosphere" },
    { label: "ensoleillé", prompt: "bright warm sunlight" },
    { label: "ombres marquées", prompt: "strong hard cast shadows" },
  ],
  ambiance: [
    { label: "joyeux", prompt: "a joyful, cheerful, playful mood" },
    { label: "mélancolique", prompt: "a melancholic, sad, wistful mood" },
    { label: "calme", prompt: "a calm, serene, peaceful mood" },
    { label: "énergique", prompt: "an energetic, dynamic, vibrant mood" },
    { label: "mystérieux", prompt: "a mysterious, enigmatic mood" },
    { label: "élégant", prompt: "an elegant, refined, sophisticated mood" },
    { label: "chaotique", prompt: "a chaotic, cluttered, messy mood" },
    { label: "onirique", prompt: "a dreamy, ethereal, surreal mood" },
    { label: "nostalgique", prompt: "a nostalgic, retro, vintage mood" },
    { label: "sensuel", prompt: "a sensual, intimate mood" },
    { label: "zen", prompt: "a minimal, quiet, zen mood" },
    { label: "kitsch", prompt: "a kitsch, tacky, over-the-top aesthetic" },
    { label: "dramatique", prompt: "a dramatic, intense, theatrical mood" },
    { label: "inquiétant", prompt: "an eerie, unsettling, ominous mood" },
    { label: "chaleureux", prompt: "a warm, cozy, welcoming mood" },
    { label: "clinique", prompt: "a cold, clean, clinical mood" },
  ],
  style: [
    { label: "art déco", prompt: "an Art Deco style design with geometric gold ornament" },
    { label: "art nouveau", prompt: "an Art Nouveau style with ornate flowing floral lines" },
    { label: "bauhaus", prompt: "a Bauhaus style with primary colors and geometric forms" },
    { label: "minimalisme", prompt: "a minimalist style artwork" },
    { label: "brutalisme", prompt: "a raw brutalist concrete aesthetic" },
    { label: "pop art", prompt: "a Pop Art style with bold flat colors and comics" },
    { label: "surréalisme", prompt: "a surrealist dreamlike artwork" },
    { label: "cubisme", prompt: "a Cubist fragmented geometric painting" },
    { label: "impressionnisme", prompt: "an Impressionist painting with loose brushstrokes" },
    { label: "expressionnisme", prompt: "an Expressionist emotional distorted painting" },
    { label: "abstraction géométrique", prompt: "a geometric abstract artwork" },
    { label: "street art", prompt: "street art or graffiti" },
    { label: "cyberpunk", prompt: "a cyberpunk neon futuristic city aesthetic" },
    { label: "vaporwave", prompt: "a vaporwave aesthetic with pastel pink and purple retro graphics" },
    { label: "rétro-futurisme", prompt: "a retro-futuristic mid-century sci-fi look" },
    { label: "ligne claire", prompt: "a clean ligne claire comic style with flat colors and clear outlines" },
    { label: "psychédélique", prompt: "a psychedelic swirling colorful 60s style" },
    { label: "memphis", prompt: "a Memphis design style with squiggles and confetti shapes" },
    { label: "constructivisme", prompt: "a Russian Constructivist poster with red black diagonals" },
    { label: "baroque", prompt: "an ornate dramatic Baroque painting" },
    { label: "renaissance", prompt: "a Renaissance classical painting" },
    { label: "réalisme", prompt: "a highly realistic detailed artwork" },
    { label: "art naïf", prompt: "a naive folk art style" },
    { label: "japonisme", prompt: "a Japanese ukiyo-e woodblock print style" },
    { label: "gothique", prompt: "a dark gothic medieval aesthetic" },
    { label: "fauvisme", prompt: "a Fauvist painting with wild vivid non-natural colors" },
    { label: "pointillisme", prompt: "a Pointillist painting made of small color dots" },
  ],
  epoque: [
    { label: "années 50", prompt: "a 1950s mid-century aesthetic" },
    { label: "années 60", prompt: "a 1960s mod psychedelic aesthetic" },
    { label: "années 70", prompt: "a 1970s warm earthy aesthetic" },
    { label: "années 80", prompt: "a 1980s neon retro aesthetic" },
    { label: "années 90", prompt: "a 1990s grunge aesthetic" },
    { label: "Y2K", prompt: "an early 2000s Y2K glossy tech aesthetic" },
    { label: "médiéval", prompt: "a medieval illuminated manuscript aesthetic" },
    { label: "antiquité", prompt: "an ancient classical antiquity aesthetic" },
    { label: "victorien", prompt: "an ornate Victorian era aesthetic" },
    { label: "futuriste", prompt: "a futuristic sci-fi aesthetic" },
  ],
  typo: [
    { label: "serif", prompt: "text set in a classic serif typeface" },
    { label: "sans-serif", prompt: "text set in a clean sans-serif typeface" },
    { label: "script", prompt: "text in a cursive handwritten script typeface" },
    { label: "display", prompt: "big bold decorative display lettering" },
    { label: "lettering manuel", prompt: "hand-lettered custom letters" },
    { label: "monospace", prompt: "text in a monospace typewriter font" },
    { label: "gothique", prompt: "blackletter gothic calligraphy lettering" },
  ],
};

// ── Liste À PLAT canonique (ordre STABLE) ────────────────────────────────────
// Catégories d'abord, puis les groupes de tags dans l'ordre de TAG_GROUPS. Cet
// ordre EST le contrat entre la génération d'embeddings (offline) et le moteur
// (runtime) : l'embedding d'indice i correspond à flatConcepts()[i].
export function flatConcepts() {
  const out = [];
  for (const c of CATEGORY_CONCEPTS) out.push({ kind: "category", prompt: c.prompt, category: c.category, subcategory: c.subcategory });
  for (const [group, concepts] of Object.entries(TAG_GROUPS)) {
    for (const t of concepts) out.push({ kind: "tag", prompt: t.prompt, group, label: t.label });
  }
  return out;
}

// Gabarits d'hypothèse pour l'ENSEMBLING de prompts : on encode chaque concept
// avec plusieurs phrases neutres puis on MOYENNE les embeddings (L2). Réduit le
// bruit propre à un gabarit unique et le biais « photo » sur le contenu non
// photographique. Phrases complètes (SigLIP est entraîné sur des phrases).
export const PROMPT_TEMPLATES = [
  "This is a photo of {}.",
  "This is an image of {}.",
  "This is a picture of {}.",
];

// Applique un gabarit à un prompt de concept.
export function siglipText(prompt, template = PROMPT_TEMPLATES[0]) {
  return template.replace("{}", prompt);
}
