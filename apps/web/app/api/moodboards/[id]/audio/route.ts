import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { uploadToR2, deleteFromR2 } from "@/lib/storage/r2";
import { checkUploadAllowed, checkAudioMimeType, QUOTA } from "@/lib/storage/quota";
import { parseWordTimingsField } from "@/lib/audio/wordTimings";
import { randomUUID } from "crypto";

interface Params { params: Promise<{ id: string }> }

// POST /api/moodboards/[id]/audio — upload d'un mémo vocal inséré comme bloc
// sur une planche (canvas). Miroir direct de /api/visits/[id]/audio — même
// filet anti-orphelins R2 (purge immédiate si la création DB échoue après un
// upload réussi). Voir components/moodboard/AudioMemoCard.tsx pour le rendu.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const moodboard = await db.moodboard.findFirst({ where: { id, userId }, select: { id: true } });
  if (!moodboard) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const durationSec = Number(formData.get("durationSec") ?? 0) || null;
  const transcript = (formData.get("transcript") as string | null)?.trim() || null;
  const wordTimings = parseWordTimingsField(formData.get("wordTimings"));
  if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });

  if (!checkAudioMimeType(file.type)) {
    return NextResponse.json({ error: "Format audio non supporté" }, { status: 400 });
  }
  if (file.size > QUOTA.MAX_AUDIO_SIZE_BYTES) {
    return NextResponse.json({ error: "Clip audio trop lourd" }, { status: 413 });
  }

  const quotaCheck = await checkUploadAllowed(userId, file.size);
  if (!quotaCheck.allowed) {
    return NextResponse.json({ error: quotaCheck.reason }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.type.split(";")[0].split("/")[1] ?? "webm";
  const storageKey = `moodboard-audio/${randomUUID()}.${ext}`;

  try {
    await uploadToR2(storageKey, buffer, file.type.split(";")[0]);
  } catch (error) {
    console.error("[MOODBOARD AUDIO UPLOAD ERROR]", error);
    return NextResponse.json({ error: "Erreur lors du traitement" }, { status: 500 });
  }

  try {
    const [audio, author] = await Promise.all([
      db.moodboardAudio.create({
        data: { moodboardId: id, storageKey, size: buffer.length, durationSec, transcript, wordTimings: (wordTimings ?? undefined) as Prisma.InputJsonValue | undefined, authorId: userId },
      }),
      db.user.findUnique({ where: { id: userId }, select: { name: true, image: true } }),
    ]);

    return NextResponse.json({
      id: audio.id,
      storageKey: audio.storageKey,
      size: audio.size,
      durationSec: audio.durationSec,
      transcript: audio.transcript,
      wordTimings: audio.wordTimings,
      authorName: author?.name ?? null,
      authorImage: author?.image ?? null,
    });
  } catch (error) {
    // Upload R2 réussi mais création DB échouée : purge immédiate de l'objet
    // R2 orphelin (même filet que /api/visits/[id]/audio).
    await deleteFromR2(storageKey).catch(() => {});
    console.error("[MOODBOARD AUDIO CREATE ERROR]", error);
    return NextResponse.json({ error: "Erreur lors du traitement" }, { status: 500 });
  }
}
