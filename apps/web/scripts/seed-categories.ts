/**
 * Seed des catégories et sous-catégories.
 * Lance avec : npx tsx scripts/seed-categories.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const CATEGORIES: {
  name: string;
  slug: string;
  icon: string;
  description: string;
  order: number;
  subcategories: { name: string; slug: string }[];
}[] = [
  {
    name: "Photographie",
    slug: "photographie",
    icon: "◉",
    description: "Photographie argentique, numérique, documentaire",
    order: 1,
    subcategories: [
      { name: "Portrait", slug: "portrait" },
      { name: "Mode", slug: "mode-photo" },
      { name: "Architecture", slug: "architecture-photo" },
      { name: "Paysage", slug: "paysage" },
      { name: "Documentaire", slug: "documentaire" },
      { name: "Still life", slug: "still-life" },
      { name: "Street", slug: "street" },
      { name: "Expérimental", slug: "experimental-photo" },
    ],
  },
  {
    name: "Cinéma & Vidéo",
    slug: "cinema",
    icon: "▶",
    description: "Film, court métrage, clip, publicité, animation",
    order: 2,
    subcategories: [
      { name: "Long métrage", slug: "long-metrage" },
      { name: "Court métrage", slug: "court-metrage" },
      { name: "Clip musical", slug: "clip-musical" },
      { name: "Publicité", slug: "publicite" },
      { name: "Documentaire", slug: "documentaire-video" },
      { name: "Animation", slug: "animation" },
      { name: "Expérimental", slug: "experimental-video" },
    ],
  },
  {
    name: "Motion Design",
    slug: "motion-design",
    icon: "◈",
    description: "Animation graphique, générique, VFX, motion graphics",
    order: 3,
    subcategories: [
      { name: "Motion graphics", slug: "motion-graphics" },
      { name: "Générique", slug: "generique" },
      { name: "Animation 3D", slug: "animation-3d" },
      { name: "VFX", slug: "vfx" },
      { name: "Kinetic typography", slug: "kinetic-typography" },
      { name: "Interactive", slug: "interactive" },
    ],
  },
  {
    name: "Design graphique",
    slug: "design-graphique",
    icon: "◻",
    description: "Affiche, éditorial, branding, typographie, packaging",
    order: 4,
    subcategories: [
      { name: "Affiche / Poster", slug: "affiche" },
      { name: "Design éditorial", slug: "editorial" },
      { name: "Branding", slug: "branding" },
      { name: "Typographie", slug: "typographie" },
      { name: "Packaging", slug: "packaging" },
      { name: "UI / Interface", slug: "ui" },
      { name: "Signalétique", slug: "signaletique" },
    ],
  },
  {
    name: "Illustration",
    slug: "illustration",
    icon: "✦",
    description: "Illustration éditoriale, concept art, BD, presse",
    order: 5,
    subcategories: [
      { name: "Illustration éditoriale", slug: "illustration-editoriale" },
      { name: "Concept art", slug: "concept-art" },
      { name: "BD / Bande dessinée", slug: "bd" },
      { name: "Presse", slug: "illustration-presse" },
      { name: "Numérique", slug: "illustration-numerique" },
      { name: "Technique mixte", slug: "technique-mixte" },
    ],
  },
  {
    name: "Art contemporain",
    slug: "art-contemporain",
    icon: "○",
    description: "Peinture, sculpture, installation, performance, art numérique",
    order: 6,
    subcategories: [
      { name: "Peinture", slug: "peinture" },
      { name: "Sculpture", slug: "sculpture" },
      { name: "Installation", slug: "installation" },
      { name: "Art numérique", slug: "art-numerique" },
      { name: "Performance", slug: "performance" },
      { name: "Dessin", slug: "dessin" },
      { name: "Gravure", slug: "gravure" },
      { name: "Céramique", slug: "ceramique" },
    ],
  },
  {
    name: "Architecture & Espace",
    slug: "architecture",
    icon: "▣",
    description: "Architecture, design d'intérieur, scénographie, urbanisme",
    order: 7,
    subcategories: [
      { name: "Architecture", slug: "architecture-batiment" },
      { name: "Intérieur", slug: "design-interieur" },
      { name: "Scénographie", slug: "scenographie" },
      { name: "Urbanisme", slug: "urbanisme" },
      { name: "Paysagisme", slug: "paysagisme" },
      { name: "Set design", slug: "set-design" },
    ],
  },
  {
    name: "Mode & Textile",
    slug: "mode",
    icon: "◇",
    description: "Haute couture, prêt-à-porter, accessoires, textile",
    order: 8,
    subcategories: [
      { name: "Haute couture", slug: "haute-couture" },
      { name: "Prêt-à-porter", slug: "pret-a-porter" },
      { name: "Accessoires", slug: "accessoires" },
      { name: "Textile", slug: "textile" },
      { name: "Costume", slug: "costume" },
    ],
  },
  {
    name: "Direction artistique",
    slug: "direction-artistique",
    icon: "◬",
    description: "DA de campagnes, direction photo, art direction éditoriale",
    order: 9,
    subcategories: [
      { name: "Campagne", slug: "campagne" },
      { name: "Direction photo", slug: "direction-photo" },
      { name: "Éditorial", slug: "da-editorial" },
      { name: "Clip / Film", slug: "da-clip" },
    ],
  },
  {
    name: "Design industriel",
    slug: "design-industriel",
    icon: "⬡",
    description: "Objet, mobilier, product design, design de transport",
    order: 10,
    subcategories: [
      { name: "Product design", slug: "product-design" },
      { name: "Mobilier", slug: "mobilier" },
      { name: "Design de transport", slug: "transport" },
      { name: "Électronique", slug: "electronique" },
    ],
  },
];

async function main() {
  console.log("🌱 Seed des catégories...\n");

  let created = 0;
  let skipped = 0;

  for (const cat of CATEGORIES) {
    const { subcategories, ...catData } = cat;

    // Upsert catégorie (ne pas écraser si elle existe)
    const existing = await db.category.findUnique({ where: { slug: cat.slug } });

    let categoryId: string;

    if (existing) {
      console.log(`  ⏭  Catégorie existante : ${cat.name}`);
      categoryId = existing.id;
      skipped++;
    } else {
      const created_ = await db.category.create({ data: catData });
      console.log(`  ✅ Catégorie créée : ${cat.name}`);
      categoryId = created_.id;
      created++;
    }

    // Sous-catégories
    for (const sub of subcategories) {
      const existingSub = await db.subcategory.findUnique({
        where: { categoryId_slug: { categoryId, slug: sub.slug } },
      });
      if (!existingSub) {
        await db.subcategory.create({
          data: { ...sub, categoryId },
        });
      }
    }
  }

  console.log(`\n✅ Terminé — ${created} créées, ${skipped} ignorées`);
  console.log(`   ${CATEGORIES.reduce((acc, c) => acc + c.subcategories.length, 0)} sous-catégories vérifiées`);
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
