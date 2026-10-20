import { db } from "@/lib/db";

// ============================================================
// IMPORT VIDÉO PAR LIEN (TikTok / Instagram / générique → GIF)
//
// Même philosophie que lib/storage/quota.ts : constantes explicites,
// messages d'erreur clairs.
//
// Le plafond quotidien compte les imports RÉUSSIS (une Inspiration créée),
// pas les tentatives — pas besoin d'une table dédiée : Inspiration a déjà
// `source`/`sourceUrl` (utilisés par l'import Pinterest/Instagram existant,
// /api/import/url), on les réutilise. Les libellés ci-dessous sont
// DÉLIBÉRÉMENT distincts de ceux posés par /api/import/url (qui met aussi
// source = "Instagram", mais pour des PHOTOS) : sinon le comptage du
// plafond ci-dessous inclurait des imports qui n'ont rien à voir.
// ============================================================

export type VideoLinkPlatform = "tiktok" | "instagram" | "youtube" | "generic";

export const VIDEO_LINK = {
  // Plafond quotidien par profil — illimité pour ADMIN (voir checkDailyVideoLinkQuota).
  DAILY_LIMIT: parseInt(process.env.VIDEO_LINK_DAILY_LIMIT ?? "20"),

  // Limites appliquées sur la vidéo SOURCE (avant tout téléchargement), à
  // partir des métadonnées yt-dlp (-J, sans téléchargement).
  MAX_SOURCE_DURATION_S: parseInt(process.env.VIDEO_LINK_MAX_DURATION_S ?? "600"), // 10 min
  MAX_SOURCE_BYTES: parseInt(process.env.VIDEO_LINK_MAX_BYTES ?? String(500 * 1024 * 1024)), // 500 Mo

  // Sous-flux YouTube (#7) : on ne télécharge JAMAIS la vidéo entière, juste
  // la plage choisie par l'utilisateur AVANT tout téléchargement — plafond
  // bien plus bas que MAX_SOURCE_DURATION_S, qui ne s'applique pas ici.
  MAX_SECTION_DURATION_S: parseInt(process.env.VIDEO_LINK_MAX_SECTION_DURATION_S ?? "90"),
  // Marge ajoutée de part et d'autre de la plage choisie avant l'appel
  // yt-dlp --download-sections, pour laisser de quoi affiner dans
  // VideoTrimModal ensuite (sinon la section téléchargée est pile la plage
  // déjà choisie, sans rien à ajuster).
  SECTION_PADDING_S: parseInt(process.env.VIDEO_LINK_SECTION_PADDING_S ?? "3"),

  SOURCE_LABELS: {
    tiktok: "TikTok (vidéo)",
    instagram: "Instagram (vidéo)",
    // Libellé délibérément distinct de "YouTube" (posé par l'import de
    // stills existant, /api/youtube) : sinon le comptage du plafond
    // quotidien mélangerait deux fonctionnalités différentes.
    youtube: "YouTube (section)",
    generic: "Vidéo (lien)",
  } satisfies Record<VideoLinkPlatform, string>,
} as const;

export function detectPlatform(rawUrl: string): VideoLinkPlatform {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "generic";
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be"
  ) {
    return "youtube";
  }
  return "generic";
}

export function sourceLabelFor(platform: VideoLinkPlatform): string {
  return VIDEO_LINK.SOURCE_LABELS[platform];
}

export interface VideoLinkQuotaStatus {
  allowed: boolean;
  usedToday: number;
  limit: number;
  reason?: string;
}

export async function checkDailyVideoLinkQuota(
  userId: string,
  role: "ADMIN" | "USER",
): Promise<VideoLinkQuotaStatus> {
  if (role === "ADMIN") {
    return { allowed: true, usedToday: 0, limit: VIDEO_LINK.DAILY_LIMIT };
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const usedToday = await db.inspiration.count({
    where: {
      userId,
      createdAt: { gte: startOfDay },
      source: { in: Object.values(VIDEO_LINK.SOURCE_LABELS) },
    },
  });

  if (usedToday >= VIDEO_LINK.DAILY_LIMIT) {
    return {
      allowed: false,
      usedToday,
      limit: VIDEO_LINK.DAILY_LIMIT,
      reason: `Limite quotidienne d'imports vidéo atteinte (${VIDEO_LINK.DAILY_LIMIT}/jour). Réessaie demain.`,
    };
  }
  return { allowed: true, usedToday, limit: VIDEO_LINK.DAILY_LIMIT };
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return m > 0 ? `${m} min ${s}s` : `${s}s`;
}

export function formatBytesMb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} Mo`;
}
