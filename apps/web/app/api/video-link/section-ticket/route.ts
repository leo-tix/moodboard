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
} from "@/lib/video/videoLink";

// Ticket du sous-flux YouTube dédié (#7) — distinct de /api/video-link/ticket
// (#6, téléchargement complet TikTok/Instagram/générique) : une vidéo
// YouTube peut être longue, donc on ne télécharge JAMAIS la vidéo entière
// ici, seulement la plage que l'utilisateur a choisie dans le lecteur
// embarqué AVANT tout téléchargement — via la route /fetch-url-section du
// worker (yt-dlp --download-sections). Même mécanisme de ticket signé à
// courte durée de vie que /api/video-link/ticket et /api/gif/ticket (le
// jeton n'est lié à aucune URL/plage précise, c'est le worker qui revalide
// tout réellement).
const TICKET_TTL_S = 300;

interface YtDlpMeta {
  title?: string | null;
  durationS?: number;
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
  const start = Number(body?.start);
  const end = Number(body?.end);
  if (!rawUrl) {
    return NextResponse.json({ error: "Lien manquant." }, { status: 400 });
  }
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start) {
    return NextResponse.json({ error: "Plage invalide." }, { status: 400 });
  }
  if (end - start > VIDEO_LINK.MAX_SECTION_DURATION_S) {
    return NextResponse.json(
      { error: `Passage trop long (max ${formatDuration(VIDEO_LINK.MAX_SECTION_DURATION_S)}).` },
      { status: 422 },
    );
  }

  try {
    await assertPublicUrl(rawUrl);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof BlockedUrlError ? e.message : "URL invalide." },
      { status: 400 },
    );
  }

  const platform = detectPlatform(rawUrl);
  if (platform !== "youtube") {
    return NextResponse.json({ error: "Ce sous-flux est réservé aux liens YouTube." }, { status: 400 });
  }

  // Même compteur que /api/video-link/ticket (checkDailyVideoLinkQuota compte
  // les imports RÉUSSIS, cf. ce fichier) : "youtube" a son propre libellé
  // dans VIDEO_LINK.SOURCE_LABELS, inclus dans le `in` du comptage.
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
  const workerOrigin = new URL(workerUrl).origin;

  // Durée totale de la vidéo — SANS rien télécharger (yt-dlp -J côté
  // worker) : sert à clamper la marge ajoutée ci-dessous et à rejeter tôt
  // une plage hors limites.
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
        "Impossible de lire cette vidéo (lien invalide, privée, géo-bloquée, ou indisponible).";
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
  if (durationS > 0 && start >= durationS) {
    return NextResponse.json({ error: "Le début du passage dépasse la durée de la vidéo." }, { status: 422 });
  }

  // Marge de part et d'autre pour laisser de quoi affiner dans
  // VideoTrimModal ensuite — clampée à la durée réelle quand elle est
  // connue. Le client doit utiliser CETTE plage (et pas la sienne) pour
  // l'appel à /fetch-url-section : c'est le serveur qui décide de la marge.
  const padding = VIDEO_LINK.SECTION_PADDING_S;
  const paddedStart = Math.max(0, start - padding);
  const paddedEnd = durationS > 0 ? Math.min(durationS, end + padding) : end + padding;

  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_S;
  const mac = crypto.createHmac("sha256", secret).update(String(exp)).digest("hex");

  return NextResponse.json({
    url: `${workerOrigin}/fetch-url-section`,
    token: `${exp}.${mac}`,
    expiresAt: exp,
    platform,
    sourceLabel: sourceLabelFor(platform),
    sourceUrl: rawUrl,
    title: meta.title ?? null,
    start: paddedStart,
    end: paddedEnd,
    durationS,
    maxSectionDurationS: VIDEO_LINK.MAX_SECTION_DURATION_S,
    isAdmin,
  });
}
