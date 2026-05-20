import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { analyzeImageWithGemini, type CategoryHint } from "@/lib/ai/gemini";
import sharp from "sharp";

export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;

  const [inspiration, allCategories] = await Promise.all([
    db.inspiration.findUnique({
      where: { id },
      include: {
        images: { orderBy: [{ isMain: "desc" }, { order: "asc" }], take: 1 },
        tags: { include: { tag: true } },
        categories: true,
      },
    }),
    db.category.findMany({ select: { id: true, name: true }, orderBy: { order: "asc" } }),
  ]);

  if (!inspiration) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const mainImage = inspiration.images[0];
  if (!mainImage?.thumbnailKey) {
    return NextResponse.json({ error: "Aucune image disponible" }, { status: 400 });
  }

  // Download thumbnail from R2 public URL
  const imageUrl = `${process.env.R2_PUBLIC_URL}/${mainImage.thumbnailKey}`;
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) return NextResponse.json({ error: "Impossible de récupérer l'image" }, { status: 500 });
  const rawBuffer = Buffer.from(await imageRes.arrayBuffer());

  // Resize to 256px max — keeps Gemini payload small (~10-20KB vs ~150KB)
  const smallBuffer = await sharp(rawBuffer)
    .resize(256, 256, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer();

  // Analyze with Gemini — pass categories for smart matching
  const categoryHints: CategoryHint[] = allCategories.map((c) => ({ id: c.id, name: c.name }));
  const analysis = await analyzeImageWithGemini(smallBuffer, "image/jpeg", categoryHints);

  // Upsert AIAnalysis
  await db.aIAnalysis.upsert({
    where: { inspirationId: id },
    create: {
      inspirationId: id,
      rawResponse: analysis as object,
      styleKeywords: analysis.styleKeywords,
      moodDescriptor: analysis.moodDescriptor,
      technicalNotes: analysis.technicalNotes,
    },
    update: {
      rawResponse: analysis as object,
      styleKeywords: analysis.styleKeywords,
      moodDescriptor: analysis.moodDescriptor,
      technicalNotes: analysis.technicalNotes,
      processedAt: new Date(),
    },
  });

  // Filter out tags that already exist on this inspiration
  const existingNames = new Set(inspiration.tags.map((t) => t.tag.name.toLowerCase()));
  const suggestedTags = analysis.tags.filter((t) => !existingNames.has(t.toLowerCase()));

  // Filter out categories already assigned + validate ids exist
  const existingCatIds = new Set(inspiration.categories.map((c) => c.categoryId));
  const validCatIds = new Set(allCategories.map((c) => c.id));
  const suggestedCategories = (analysis.suggestedCategoryIds ?? [])
    .filter((cid) => validCatIds.has(cid) && !existingCatIds.has(cid))
    .map((cid) => allCategories.find((c) => c.id === cid)!)
    .filter(Boolean);

  return NextResponse.json({
    analysis: {
      moodDescriptor: analysis.moodDescriptor,
      styleKeywords: analysis.styleKeywords,
      technicalNotes: analysis.technicalNotes,
      suggestedTitle: analysis.suggestedTitle,
    },
    suggestedTags,
    suggestedCategories,
  });
}
