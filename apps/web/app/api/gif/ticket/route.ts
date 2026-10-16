import { NextResponse } from "next/server";
import { auth } from "@/auth";
import crypto from "crypto";

// Émet un ticket signé à courte durée de vie pour le service VPS de
// conversion vidéo → GIF (apps/gif-worker). Le navigateur envoie la vidéo
// DIRECTEMENT à ce service (pas via une fonction Vercel) — une vidéo
// dépasse facilement la limite de payload des fonctions serverless
// (~4.5 Mo) ; seul le GIF résultant (petit) revient ensuite par
// /api/upload/image, inchangée.
//
// Le secret partagé (GIF_WORKER_TOKEN) ne quitte jamais le serveur : le
// navigateur ne reçoit qu'un ticket "<expiration>.<hmac>" qui expire vite
// et ne permet qu'une poignée de conversions avant de devoir en redemander
// un — chaque émission exige une session utilisateur valide.
const TICKET_TTL_S = 300;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const workerUrl = process.env.GIF_WORKER_URL;
  const secret = process.env.GIF_WORKER_TOKEN;
  if (!workerUrl || !secret) {
    return NextResponse.json(
      { error: "Service de conversion GIF non configuré." },
      { status: 503 },
    );
  }

  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_S;
  const mac = crypto.createHmac("sha256", secret).update(String(exp)).digest("hex");

  return NextResponse.json({
    url: workerUrl,
    token: `${exp}.${mac}`,
    expiresAt: exp,
    // Limites appliquées côté worker — exposées pour une validation client
    // précoce, avant même la tentative d'envoi.
    maxDurationS: Number(process.env.GIF_MAX_DURATION_S || 15),
    maxUploadBytes: Number(process.env.GIF_MAX_UPLOAD_BYTES || 150 * 1024 * 1024),
  });
}
