import { db } from "@/lib/db";

// ============================================================
// LIMITES CONSERVATRICES (largement sous les seuils gratuits)
// Cloudflare R2 gratuit : 10 GB stockage, 1M ops Class A/mois
// On se limite à 70% pour ne JAMAIS dépasser
// ============================================================
export const QUOTA = {
  // Stockage total max : 7 GB (70% de 10 GB)
  MAX_STORAGE_BYTES: parseInt(process.env.R2_MAX_STORAGE_BYTES ?? "7516192768"),

  // Taille max par fichier : 10 MB
  MAX_FILE_SIZE_BYTES: parseInt(process.env.R2_MAX_FILE_SIZE_BYTES ?? "10485760"),

  // Formats acceptés
  ALLOWED_MIME_TYPES: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/tiff",
  ],

  // Nombre max d'images par inspiration
  MAX_IMAGES_PER_INSPIRATION: 20,

  // Seuil d'alerte : afficher un warning à 80% du quota
  WARN_THRESHOLD: 0.8,
} as const;

export interface QuotaStatus {
  usedBytes: number;
  maxBytes: number;
  usedPercent: number;
  isNearLimit: boolean;
  isOverLimit: boolean;
  remainingBytes: number;
}

// Calcule le stockage total utilisé depuis la DB
export async function getStorageUsage(): Promise<QuotaStatus> {
  const result = await db.image.aggregate({
    _sum: { size: true },
  });

  const usedBytes = result._sum.size ?? 0;
  const maxBytes = QUOTA.MAX_STORAGE_BYTES;
  const usedPercent = usedBytes / maxBytes;

  return {
    usedBytes,
    maxBytes,
    usedPercent,
    isNearLimit: usedPercent >= QUOTA.WARN_THRESHOLD,
    isOverLimit: usedBytes >= maxBytes,
    remainingBytes: Math.max(0, maxBytes - usedBytes),
  };
}

// Vérifie si un upload est autorisé avant de l'accepter
export async function checkUploadAllowed(fileSizeBytes: number): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  if (fileSizeBytes > QUOTA.MAX_FILE_SIZE_BYTES) {
    return {
      allowed: false,
      reason: `Fichier trop lourd (max ${formatBytes(QUOTA.MAX_FILE_SIZE_BYTES)})`,
    };
  }

  const usage = await getStorageUsage();

  if (usage.isOverLimit) {
    return {
      allowed: false,
      reason: "Quota de stockage atteint (7 GB). Supprime des fichiers.",
    };
  }

  if (usage.usedBytes + fileSizeBytes > QUOTA.MAX_STORAGE_BYTES) {
    return {
      allowed: false,
      reason: `Fichier dépasserait le quota. Espace restant : ${formatBytes(usage.remainingBytes)}`,
    };
  }

  return { allowed: true };
}

// Vérifie le type MIME
export function checkMimeType(mimeType: string): boolean {
  return QUOTA.ALLOWED_MIME_TYPES.includes(
    mimeType as (typeof QUOTA.ALLOWED_MIME_TYPES)[number]
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
