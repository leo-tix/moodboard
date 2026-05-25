/**
 * Migration one-shot : peuple thumbnailKey sur les ImageElement des moodboards existants.
 *
 * Les thumbnails existent déjà dans R2 (bucket thumbs/) — la clé est stockée
 * dans la table `images` (Image.thumbnailKey). Ce script la copie dans chaque
 * ImageElement du JSON canvasData de chaque moodboard.
 *
 * Idempotent : les éléments qui ont déjà un thumbnailKey ne sont pas touchés.
 *
 * Lancer avec :
 *   npx tsx scripts/migrate-thumbnail-keys.ts
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

interface ImageElement {
  type: "image";
  id: string;
  storageKey: string;
  thumbnailKey?: string;
  [key: string]: unknown;
}

interface CanvasElement {
  type: string;
  [key: string]: unknown;
}

async function main() {
  console.log("🔍 Chargement des moodboards…");

  const moodboards = await db.moodboard.findMany({
    select: { id: true, canvasData: true },
  });

  console.log(`   ${moodboards.length} moodboard(s) trouvé(s)`);

  // 1. Collecter tous les storageKey sans thumbnailKey
  const missingKeys = new Set<string>();

  for (const board of moodboards) {
    const elements = board.canvasData as CanvasElement[];
    if (!Array.isArray(elements)) continue;
    for (const el of elements) {
      if (el.type === "image") {
        const img = el as ImageElement;
        if (img.storageKey && !img.thumbnailKey) {
          missingKeys.add(img.storageKey);
        }
      }
    }
  }

  if (missingKeys.size === 0) {
    console.log("✅ Tous les ImageElement ont déjà un thumbnailKey. Rien à faire.");
    return;
  }

  console.log(`\n🗄️  ${missingKeys.size} storageKey(s) sans thumbnailKey — requête DB…`);

  // 2. Récupérer thumbnailKey depuis la table images en une seule requête
  const images = await db.image.findMany({
    where: { storageKey: { in: Array.from(missingKeys) } },
    select: { storageKey: true, thumbnailKey: true },
  });

  const thumbMap = new Map<string, string>();
  for (const img of images) {
    if (img.thumbnailKey) thumbMap.set(img.storageKey, img.thumbnailKey);
  }

  const found    = thumbMap.size;
  const notFound = missingKeys.size - found;
  console.log(`   ${found} clé(s) trouvée(s) en DB`);
  if (notFound > 0) {
    console.log(`   ⚠️  ${notFound} storageKey(s) sans correspondance en DB (images orphelines, ignorées)`);
  }

  if (found === 0) {
    console.log("❌ Aucune thumbnailKey trouvée en DB. Vérifier la table images.");
    return;
  }

  // 3. Mettre à jour les moodboards
  let boardsUpdated = 0;
  let elementsUpdated = 0;

  for (const board of moodboards) {
    const elements = board.canvasData as CanvasElement[];
    if (!Array.isArray(elements)) continue;

    let changed = false;
    const updated = elements.map((el) => {
      if (el.type !== "image") return el;
      const img = el as ImageElement;
      if (img.thumbnailKey) return el; // déjà présent
      const thumbKey = thumbMap.get(img.storageKey);
      if (!thumbKey) return el; // pas de correspondance
      changed = true;
      elementsUpdated++;
      return { ...img, thumbnailKey: thumbKey };
    });

    if (!changed) continue;

    await db.moodboard.update({
      where: { id: board.id },
      data: { canvasData: updated as object[] },
    });
    boardsUpdated++;
    process.stdout.write(`   ✔ moodboard ${board.id}\n`);
  }

  console.log(`\n✅ Migration terminée`);
  console.log(`   ${boardsUpdated} moodboard(s) mis à jour`);
  console.log(`   ${elementsUpdated} ImageElement(s) mis à jour`);
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1); })
  .finally(() => db.$disconnect());
