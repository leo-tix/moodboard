import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { uploadToR2, deleteFromR2 } from "@/lib/storage/r2";
import { checkUploadAllowed, checkAudioMimeType, QUOTA } from "@/lib/storage/quota";
import { nextBlockOrder } from "@/lib/visits/blockOrder";
import { parseWordTimingsField } from "@/lib/audio/wordTimings";
import { randomUUID } from "crypto";

interface Params { params: Promise<{ id: string }> }

// POST /api/visits/[id]/audio — upload d'un clip audio, bloc autonome du
// carnet (waveform + transcription, voir components/visits/AudioPlayer.tsx).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const visit = await db.visit.findFirst({ where: { id, userId }, select: { id: true } });
  if (!visit) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const durationSec = Number(formData.get("durationSec") ?? 0) || null;
  const transcript = (formData.get("transcript") as string | null)?.trim() || null;
  // Timings par mot (Whisper) — JSON sérialisé, best-effort : parsé
  // défensivement, ignoré si malformé (le mémo reste enregistrable sans).
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
  const storageKey = `visit-audio/${randomUUID()}.${ext}`;

  try {
    await uploadToR2(storageKey, buffer, file.type.split(";")[0]);
  } catch (error) {
    console.error("[VISIT AUDIO UPLOAD ERROR]", error);
    return NextResponse.json({ error: "Erreur lors du traitement" }, { status: 500 });
  }

  try {
    const order = await nextBlockOrder(id);
    const audio = await db.visitAudio.create({
      data: { visitId: id, storageKey, size: buffer.length, durationSec, transcript, wordTimings: (wordTimings ?? undefined) as Prisma.InputJsonValue | undefined, order },
    });

    return NextResponse.json({
      id: audio.id,
      storageKey: audio.storageKey,
      size: audio.size,
      durationSec: audio.durationSec,
      transcript: audio.transcript,
      wordTimings: audio.wordTimings,
    });
  } catch (error) {
    // L'upload R2 a réussi mais la création en base a échoué (visite
    // supprimée entre-temps, coupure DB…) : purge immédiate de l'objet R2
    // orphelin, sinon il reste indéfiniment sans aucune ligne VisitAudio pour
    // le référencer (voir aussi lib/storage/orphanAudio.ts, filet de
    // sécurité pour les orphelins déjà existants).
    await deleteFromR2(storageKey).catch(() => {});
    console.error("[VISIT AUDIO CREATE ERROR]", error);
    return NextResponse.json({ error: "Erreur lors du traitement" }, { status: 500 });
  }
}
