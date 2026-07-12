import { db } from "@/lib/db";

// ============================================================
// QUOTAS CLOUDFLARE R2 — Limites conservatrices à 70%
//
// Free tier réel :
//   Storage    : 10 GB/mois
//   Class A ops: 1 000 000/mois  (write, delete, list)
//   Class B ops: 10 000 000/mois (read via API — PAS via URL publique)
//
// Pourquoi Class B ops ne sont PAS trackées :
//   Les images sont servies via URL publique R2 directement depuis
//   le navigateur → Cloudflare. Ces reads ne transitent pas par
//   notre serveur et sont comptabilisées différemment.
//   Pour un usage personnel, 10M reads/mois est impossible à atteindre.
//
// Class A ops trackées car elles passent par notre API upload.
//   Chaque upload = 2 ops (original + thumbnail)
//   Chaque suppression = 2 ops (original + thumbnail)
// ============================================================

export const QUOTA = {
  // Storage : 7 GB (70% de 10 GB)
  MAX_STORAGE_BYTES: parseInt(process.env.R2_MAX_STORAGE_BYTES ?? "7516192768"),

  // Taille max par fichier : 10 MB
  MAX_FILE_SIZE_BYTES: parseInt(process.env.R2_MAX_FILE_SIZE_BYTES ?? "10485760"),

  // Class A ops mensuelles : 700 000 (70% de 1 000 000)
  MAX_CLASS_A_OPS_MONTHLY: parseInt(process.env.R2_MAX_CLASS_A_OPS_MONTHLY ?? "700000"),

  // Formats acceptés
  ALLOWED_MIME_TYPES: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/tiff",
  ] as const,

  // Max images par inspiration
  MAX_IMAGES_PER_INSPIRATION: 20,

  // Audio des notes de carnet — formats issus de MediaRecorder navigateur
  ALLOWED_AUDIO_MIME_TYPES: [
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/mpeg",
  ] as const,
  // Taille max par clip audio : 15 MB (largement suffisant, ~15 min en webm/opus)
  MAX_AUDIO_SIZE_BYTES: parseInt(process.env.R2_MAX_AUDIO_SIZE_BYTES ?? "15728640"),

  // Seuil d'alerte (warning UI)
  WARN_THRESHOLD: 0.8,

  // Ops Class A consommées par action
  OPS_PER_UPLOAD: 2,   // PUT original + PUT thumbnail
  OPS_PER_DELETE: 2,   // DELETE original + DELETE thumbnail
} as const;

export interface StorageQuota {
  usedBytes: number;
  maxBytes: number;
  usedPercent: number;
  isNearLimit: boolean;
  isOverLimit: boolean;
  remainingBytes: number;
  formatted: { used: string; max: string; remaining: string };
}

export interface OpsQuota {
  usedThisMonth: number;
  maxPerMonth: number;
  usedPercent: number;
  isNearLimit: boolean;
  isOverLimit: boolean;
  remainingOps: number;
  // Estimation uploads restants possibles
  remainingUploads: number;
}

export interface FullQuotaStatus {
  storage: StorageQuota;
  ops: OpsQuota;
}

// ── Calcule le stockage utilisé par UN profil ──────────────
// Multi-profils : chaque profil a son propre plafond (User.storageQuotaBytes) et
// ne compte que SES objets. Images filtrées via inspiration.userId ; l'avatar du
// profil (User.imageSize) est un 3e type d'objet R2 additionné séparément.
// Chaque image écrit 2 objets R2 (original + vignette) — les deux sont comptés.
export async function getStorageQuota(userId: string): Promise<StorageQuota> {
  const [images, audio, user] = await Promise.all([
    db.image.aggregate({
      where: { inspiration: { userId } },
      _sum: { size: true, thumbnailSize: true },
    }),
    db.visitAudio.aggregate({
      where: { visit: { userId } },
      _sum: { size: true },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { imageSize: true, storageQuotaBytes: true },
    }),
  ]);
  const usedBytes =
    (images._sum.size ?? 0) +
    (images._sum.thumbnailSize ?? 0) +
    (audio._sum.size ?? 0) +
    (user?.imageSize ?? 0);
  // storageQuotaBytes est un BigInt en base ; toutes les valeurs de quota
  // (< 2^53) tiennent dans un number JS.
  const maxBytes = Number(user?.storageQuotaBytes ?? BigInt(QUOTA.MAX_STORAGE_BYTES));
  const usedPercent = maxBytes > 0 ? usedBytes / maxBytes : 1;

  return {
    usedBytes,
    maxBytes,
    usedPercent,
    isNearLimit: usedPercent >= QUOTA.WARN_THRESHOLD,
    isOverLimit: usedBytes >= maxBytes,
    remainingBytes: Math.max(0, maxBytes - usedBytes),
    formatted: {
      used: formatBytes(usedBytes),
      max: formatBytes(maxBytes),
      remaining: formatBytes(Math.max(0, maxBytes - usedBytes)),
    },
  };
}

// ── Vue admin : usage réel de TOUT le bucket (tous profils confondus) ──
export async function getGlobalStorageUsed(): Promise<number> {
  const [images, audio, users] = await Promise.all([
    db.image.aggregate({ _sum: { size: true, thumbnailSize: true } }),
    db.visitAudio.aggregate({ _sum: { size: true } }),
    db.user.aggregate({ _sum: { imageSize: true } }),
  ]);
  return (
    (images._sum.size ?? 0) +
    (images._sum.thumbnailSize ?? 0) +
    (audio._sum.size ?? 0) +
    (users._sum.imageSize ?? 0)
  );
}

// ── Somme des quotas attribués à tous les profils ──────────
export async function getAllocatedQuota(): Promise<number> {
  const users = await db.user.findMany({ select: { storageQuotaBytes: true } });
  return users.reduce((sum, u) => sum + Number(u.storageQuotaBytes), 0);
}

// ── Garde-fou : peut-on attribuer `newQuotaBytes` sans dépasser le global ? ──
// excludeUserId : profil dont on remplace le quota (ré-attribution). Absent =
// nouveau profil. availableBytes = ce qu'il reste à distribuer.
export async function canAllocateQuota(
  newQuotaBytes: number,
  excludeUserId?: string
): Promise<{ ok: boolean; availableBytes: number }> {
  const users = await db.user.findMany({
    where: excludeUserId ? { id: { not: excludeUserId } } : undefined,
    select: { storageQuotaBytes: true },
  });
  const otherAllocated = users.reduce((sum, u) => sum + Number(u.storageQuotaBytes), 0);
  const availableBytes = Math.max(0, QUOTA.MAX_STORAGE_BYTES - otherAllocated);
  return { ok: newQuotaBytes <= availableBytes, availableBytes };
}

// ── Calcule les ops Class A du mois courant ────────────────
// On compte les images créées ce mois × OPS_PER_UPLOAD
// + les suppressions (non trackées précisément → estimation conservative)
export async function getOpsQuota(): Promise<OpsQuota> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const uploadsThisMonth = await db.image.count({
    where: { createdAt: { gte: startOfMonth } },
  });

  // Chaque upload consomme OPS_PER_UPLOAD Class A ops
  // On ajoute 20% de marge pour les suppressions et list ops
  const usedThisMonth = Math.ceil(uploadsThisMonth * QUOTA.OPS_PER_UPLOAD * 1.2);
  const maxPerMonth = QUOTA.MAX_CLASS_A_OPS_MONTHLY;
  const usedPercent = usedThisMonth / maxPerMonth;

  return {
    usedThisMonth,
    maxPerMonth,
    usedPercent,
    isNearLimit: usedPercent >= QUOTA.WARN_THRESHOLD,
    isOverLimit: usedThisMonth >= maxPerMonth,
    remainingOps: Math.max(0, maxPerMonth - usedThisMonth),
    remainingUploads: Math.floor(
      Math.max(0, maxPerMonth - usedThisMonth) / (QUOTA.OPS_PER_UPLOAD * 1.2)
    ),
  };
}

// ── Statut complet (pour le dashboard settings) ────────────
// storage = profil courant ; ops = global (limite compte R2, non répartie).
export async function getFullQuotaStatus(userId: string): Promise<FullQuotaStatus> {
  const [storage, ops] = await Promise.all([getStorageQuota(userId), getOpsQuota()]);
  return { storage, ops };
}

// ── Vérifie si un upload est autorisé pour un profil ───────
export async function checkUploadAllowed(
  userId: string,
  fileSizeBytes: number
): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  // 1. Taille du fichier
  if (fileSizeBytes > QUOTA.MAX_FILE_SIZE_BYTES) {
    return {
      allowed: false,
      reason: `Fichier trop lourd. Maximum : ${formatBytes(QUOTA.MAX_FILE_SIZE_BYTES)}`,
    };
  }

  // 2. Storage disponible (plafond du profil)
  const storage = await getStorageQuota(userId);
  if (storage.isOverLimit) {
    return {
      allowed: false,
      reason: `Quota de stockage atteint (${storage.formatted.max}). Supprime des fichiers.`,
    };
  }
  if (storage.usedBytes + fileSizeBytes > storage.maxBytes) {
    return {
      allowed: false,
      reason: `Ce fichier dépasserait ton quota. Espace restant : ${storage.formatted.remaining}`,
    };
  }

  // 3. Ops mensuelles
  const ops = await getOpsQuota();
  if (ops.isOverLimit) {
    return {
      allowed: false,
      reason: `Quota d'opérations mensuel atteint. Réessaie le mois prochain.`,
    };
  }

  return { allowed: true };
}

// ── Type MIME ──────────────────────────────────────────────
export function checkMimeType(mimeType: string): boolean {
  return (QUOTA.ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function checkAudioMimeType(mimeType: string): boolean {
  // MediaRecorder ajoute souvent des codecs ("audio/webm;codecs=opus") —
  // on ne compare que le type de base.
  const base = mimeType.split(";")[0].trim();
  return (QUOTA.ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(base);
}

// ── Formatage ──────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
