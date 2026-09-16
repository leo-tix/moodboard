// Formats d'image acceptés à l'upload — source unique côté client.
//
// Volontairement sans dépendance serveur (`lib/storage/quota` importe la DB) :
// ce module est importé par les composants client. Les deux listes doivent
// rester alignées avec `QUOTA.ALLOWED_MIME_TYPES`.

export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

// Extensions correspondantes. Indispensable : Windows ne déclare pas toujours
// de type MIME pour .webp / .avif dans la base de registre, et le navigateur
// remonte alors un `File.type` VIDE. Filtrer uniquement sur le type MIME
// faisait disparaître ces fichiers silencieusement — c'est le bug qui
// empêchait d'envoyer des WebP (notamment les GIFs convertis en WebP animé).
export const ACCEPTED_IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
] as const;

// Valeur de l'attribut `accept` d'un <input type="file"> : types MIME ET
// extensions, pour la même raison — sans les extensions, le sélecteur de
// fichiers de Windows masque purement et simplement les .webp.
export const IMAGE_ACCEPT_ATTR = [
  ...ACCEPTED_IMAGE_MIME_TYPES,
  ...ACCEPTED_IMAGE_EXTENSIONS,
].join(",");

// Plafond d'ENTRÉE, aligné sur `QUOTA.MAX_UPLOAD_SIZE_BYTES` (50 Mo) et non
// sur le plafond de stockage (10 Mo) : le serveur recompresse tout en WebP,
// donc juger la taille brute avec la limite de sortie rejetait à tort des
// fichiers parfaitement acceptables (photos pleine résolution, WebP animés).
export const MAX_UPLOAD_SIZE_MB = 50;
export const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

export function hasAcceptedImageType(file: File): boolean {
  const type = file.type.split(";")[0].trim().toLowerCase();
  if ((ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(type)) return true;
  // Type absent ou générique : on se rabat sur l'extension.
  if (type === "" || type === "application/octet-stream") {
    return (ACCEPTED_IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(file.name));
  }
  return false;
}

export type ImageRejection = { file: File; reason: string };

// Trie les fichiers déposés/sélectionnés en acceptés / rejetés AVEC motif :
// un fichier écarté doit être expliqué, jamais avalé en silence.
export function sortImageFiles(files: File[]): {
  accepted: File[];
  rejected: ImageRejection[];
} {
  const accepted: File[] = [];
  const rejected: ImageRejection[] = [];
  for (const file of files) {
    if (!hasAcceptedImageType(file)) {
      rejected.push({ file, reason: "Format non supporté (JPG, PNG, WebP, GIF, AVIF)" });
    } else if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      rejected.push({ file, reason: `Fichier trop lourd (max ${MAX_UPLOAD_SIZE_MB} Mo)` });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}
