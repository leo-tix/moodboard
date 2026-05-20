import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { analyzeImageWithGemini } from "@/lib/ai/gemini";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;

  const inspiration = await db.inspiration.findUnique({
    where: { id },
    include: {
      images: { orderBy: [{ isMain: "desc" }, { order: "asc" }], take: 1 },
      tags: { include: { tag: true } },
    },
  });

  if (!inspiration) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const mainImage = inspiration.images[0];
  if (!mainImage?.thumbnailKey) {
    return NextResponse.json({ error: "Aucune image disponible" }, { status: 400 });
  }

  // Download thumbnail from R2 public URL
  const imageUrl = `${process.env.R2_PUBLIC_URL}/${mainImage.thumbnailKey}`;
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) return NextResponse.json({ error: "Impossible de récupérer l'image" }, { status: 500 });
  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

  // Analyze with Gemini
  const analysis = await analyzeImageWithGemini(imageBuffer, "image/webp");

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

  return NextResponse.json({
    analysis: {
      moodDescriptor: analysis.moodDescriptor,
      styleKeywords: analysis.styleKeywords,
      technicalNotes: analysis.technicalNotes,
      suggestedTitle: analysis.suggestedTitle,
    },
    suggestedTags,
  });
}
