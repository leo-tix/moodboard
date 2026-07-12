import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { uploadToR2 } from "@/lib/storage/r2";
import { checkUploadAllowed, checkAudioMimeType, QUOTA } from "@/lib/storage/quota";
import { randomUUID } from "crypto";

interface Params { params: Promise<{ id: string }> }

// POST /api/visits/[id]/audio — upload d'un clip audio enregistré depuis le
// carnet (bloc audio Tiptap, voir components/visits/tiptap/AudioBlock.ts).
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

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.type.split(";")[0].split("/")[1] ?? "webm";
    const storageKey = `visit-audio/${randomUUID()}.${ext}`;

    await uploadToR2(storageKey, buffer, file.type.split(";")[0]);

    const audio = await db.visitAudio.create({
      data: { visitId: id, storageKey, size: buffer.length, durationSec },
    });

    return NextResponse.json({
      id: audio.id,
      storageKey: audio.storageKey,
      size: audio.size,
      durationSec: audio.durationSec,
    });
  } catch (error) {
    console.error("[VISIT AUDIO UPLOAD ERROR]", error);
    return NextResponse.json({ error: "Erreur lors du traitement" }, { status: 500 });
  }
}
