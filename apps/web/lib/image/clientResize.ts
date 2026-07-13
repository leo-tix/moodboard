// Redimensionnement/ré-encodage côté client avant upload — nécessaire pour
// la capture caméra native (`<input capture>`) : les photos brutes d'un
// téléphone récent dépassent couramment 10-20 Mo (au-delà de
// `QUOTA.MAX_FILE_SIZE_BYTES`, 10 Mo), ce qui faisait échouer l'upload sans
// message clair côté FAB de capture terrain. Passer par un `<canvas>` a un
// second effet utile : le résultat est toujours du JPEG standard, même si le
// navigateur avait rendu un format exotique (HEIC sur certains iPhone selon
// réglages) que `checkMimeType` côté serveur n'accepte pas.

const MAX_DIMENSION = 2400; // suffisant pour un DAM perso, pas pour l'impression
const JPEG_QUALITY = 0.86;

export async function compressImageForUpload(file: File): Promise<File> {
  // GIF animés : un re-encodage canvas perdrait l'animation — on les laisse
  // passer tels quels (rares depuis un appareil photo de toute façon).
  if (file.type === "image/gif") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob) return file;

    // Le re-encodage grossit rarement le fichier, mais une photo déjà petite
    // et très compressée peut occasionnellement regonfler légèrement —
    // dans ce cas autant garder l'original.
    if (blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    // `createImageBitmap` peut échouer sur un format non décodable par le
    // navigateur — l'upload tentera quand même avec le fichier original,
    // le serveur renverra un message d'erreur clair si le format est refusé.
    return file;
  }
}
