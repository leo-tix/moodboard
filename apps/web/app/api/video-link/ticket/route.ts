import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import crypto from "crypto";
import { assertPublicUrl, BlockedUrlError } from "@/lib/security/safeFetch";
import {
  VIDEO_LINK,
  checkDailyVideoLinkQuota,
  detectPlatform,
  sourceLabelFor,
  formatDuration,
  formatBytesMb,
} from "@/lib/video/videoLink";

// Émet un ticket signé à courte durée de vie pour la route /fetch-url du
// worker VPS (apps/gif-worker) — même mécanisme que /api/gif/ticket (voir ce
// fichier) : le navigateur télécharge la vidéo DIRECTEMENT depuis le worker,
// jamais via une fonction Vercel (payload/réponse bien au-delà de ce
// qu'une fonction serverless peut gérer).
//
// Tout le travail de validation se fait ICI, avant d'émettre le ticket :
// session, URL publique (garde-fou SSRF, cf. lib/security/safeFetch),
// plafond quotidien par profil, puis métadonnées de la vidéo (durée, poids
// estimé — yt-dlp -J côté worker, SANS téléchargement, appelé en
// server-à-serveur avec le jeton statique partagé, jamais exposé au
// navigateur).
const TICKET_TTL_S = 300;

interface YtDlpMeta {
  title?: string | null;
  durationS?: number;
  approxBytes?: number | null;
  error?: string;
  message?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userId = session.user.id;
  const role = session.user.role ?? "USER";
  const isAdmin = role === "ADMIN";

  const body = await req.json().catch(() => null);
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
  if (!rawUrl) {
    return NextResponse.json({ error: "Lien manquant." }, { status: 400 });
  }

  try {
    await assertPublicUrl(rawUrl);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof BlockedUrlError ? e.message : "URL invalide." },
      { status: 400 },
    );
  }

  const quota = await checkDailyVideoLinkQuota(userId, role);
  if (!quota.allowed) {
    return NextResponse.json({ error: quota.reason }, { status: 429 });
  }

  const workerUrl = process.env.GIF_WORKER_URL;
  const secret = process.env.GIF_WORKER_TOKEN;
  if (!workerUrl || !secret) {
    return NextResponse.json(
      { error: "Service de conversion GIF non configuré." },
      { status: 503 },
    );
  }
  // GIF_WORKER_URL pointe historiquement sur l'endpoint /convert (voir
  // /api/gif/ticket) — on n'a besoin ici que de l'origine, le reverse proxy
  // du VPS route tout le domaine vers le même conteneur.
  const workerOrigin = new URL(workerUrl).origin;

  // Métadonnées AVANT tout téléchargement — rejet immédiat si la vidéo
  // source dépasse les plafonds, sans consommer de bande passante.
  let meta: YtDlpMeta;
  try {
    const metaRes = await fetch(`${workerOrigin}/meta-url`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: rawUrl }),
      signal: AbortSignal.timeout(25_000),
    });
    meta = await metaRes.json().catch(() => ({}) as YtDlpMeta);
    if (!metaRes.ok) {
      const friendly =
        "Impossible de lire cette vidéo (lien invalide, privé, géo-bloqué, ou plateforme non prise en charge).";
      return NextResponse.json(
        { error: friendly, ...(isAdmin && meta.message ? { detail: meta.message } : {}) },
        { status: 422 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "Service de téléchargement vidéo indisponible. Réessaie plus tard.",
        ...(isAdmin ? { detail: String((err as Error)?.message || err) } : {}),
      },
      { status: 503 },
    );
  }

  const durationS = Number(meta.durationS) || 0;
  if (durationS > VIDEO_LINK.MAX_SOURCE_DURATION_S) {
    return NextResponse.json(
      {
        error: `Vidéo trop longue (${formatDuration(durationS)}, max ${formatDuration(VIDEO_LINK.MAX_SOURCE_DURATION_S)}).`,
      },
      { status: 422 },
    );
  }
  if (meta.approxBytes && meta.approxBytes > VIDEO_LINK.MAX_SOURCE_BYTES) {
    return NextResponse.json(
      {
        error: `Vidéo trop lourde (~${formatBytesMb(meta.approxBytes)}, max ${formatBytesMb(VIDEO_LINK.MAX_SOURCE_BYTES)}).`,
      },
      { status: 422 },
    );
  }

  const platform = detectPlatform(rawUrl);
  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_S;
  const mac = crypto.createHmac("sha256", secret).update(String(exp)).digest("hex");

  return NextResponse.json({
    url: `${workerOrigin}/fetch-url`,
    token: `${exp}.${mac}`,
    expiresAt: exp,
    platform,
    sourceLabel: sourceLabelFor(platform),
    sourceUrl: rawUrl,
    title: meta.title ?? null,
    durationS,
    maxDurationS: VIDEO_LINK.MAX_SOURCE_DURATION_S,
    maxUploadBytes: VIDEO_LINK.MAX_SOURCE_BYTES,
    isAdmin,
  });
}
