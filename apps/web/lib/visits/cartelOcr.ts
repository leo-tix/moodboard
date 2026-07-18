// OCR d'un cartel de musée → pré-remplissage des champs (Phase 4, 2026-07-18).
// tesseract.js est importé DYNAMIQUEMENT : ~lourd (wasm + données de langue
// chargées à la demande depuis le CDN), on ne le met pas dans le bundle
// initial. Tout est best-effort : en cas d'échec (réseau, image illisible) on
// retombe sur la saisie manuelle.

export interface CartelFields {
  artworkTitle?: string;
  artist?: string;
  dateText?: string;
  medium?: string;
  dimensions?: string;
}

// Techniques/matériaux fréquents sur les cartels français — sert à repérer la
// ligne « technique ».
const MEDIUM_KEYWORDS = [
  "huile", "toile", "bronze", "marbre", "aquarelle", "gouache", "encre",
  "fusain", "tempera", "acrylique", "gravure", "lithographie", "eau-forte",
  "photographie", "épreuve", "terre cuite", "plâtre", "bois", "pastel",
  "sanguine", "craie", "papier", "panneau", "cuivre", "argent", "or",
  "céramique", "porcelaine", "faïence", "verre", "tapisserie", "estampe",
];

// Parse heuristique du texte OCR d'un cartel. Les cartels varient énormément :
// on extrait ce qui est fiable par motif (année, dimensions, technique) et on
// devine artiste/titre par position. L'utilisateur ajuste ensuite.
export function parseCartel(raw: string): CartelFields {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1);
  const fields: CartelFields = {};

  // Dimensions : « 77 × 53 cm », « 77 x 53 cm », « H. 200 cm »
  const dimLine = lines.find((l) => /\d+([.,]\d+)?\s*[×x]\s*\d+([.,]\d+)?\s*(cm|mm|m)\b/i.test(l) || /\bH\.?\s*\d+.*\bcm\b/i.test(l));
  if (dimLine) {
    const m = dimLine.match(/\d+([.,]\d+)?\s*[×x]\s*\d+([.,]\d+)?(\s*[×x]\s*\d+([.,]\d+)?)?\s*(cm|mm|m)\b/i);
    fields.dimensions = (m ? m[0] : dimLine).trim();
  }

  // Date : plage « 1503-1519 », « v. 1890 », année seule, siècle romain.
  const dateLine = lines.find((l) => /\b(1[0-9]{3}|20[0-9]{2})\b/.test(l) || /\b[IVXLC]+e?\s*si[eè]cle\b/i.test(l) || /\bv\.\s*\d{3,4}\b/i.test(l));
  if (dateLine) {
    const range = dateLine.match(/\b\d{3,4}\s*[-–]\s*\d{3,4}\b/);
    const around = dateLine.match(/\bv\.\s*\d{3,4}\b/i);
    const century = dateLine.match(/\b[IVXLC]+e?\s*si[eè]cle\b/i);
    const single = dateLine.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
    fields.dateText = (range?.[0] ?? around?.[0] ?? century?.[0] ?? single?.[0] ?? "").trim();
  }

  // Technique : première ligne contenant un mot-clé matériau.
  const mediumLine = lines.find((l) => MEDIUM_KEYWORDS.some((k) => l.toLowerCase().includes(k)));
  if (mediumLine) fields.medium = mediumLine.replace(/[.,;]\s*$/, "").trim();

  // Artiste : souvent la 1re ligne (NOM Prénom, parfois suivi de dates de vie
  // entre parenthèses qu'on retire). Titre : la ligne suivante.
  const used = new Set([dimLine, dateLine, mediumLine].filter(Boolean));
  const remaining = lines.filter((l) => !used.has(l));
  if (remaining[0]) fields.artist = remaining[0].replace(/\s*\([^)]*\d{3,4}[^)]*\)\s*$/, "").trim();
  if (remaining[1]) fields.artworkTitle = remaining[1].replace(/^[«"]\s*|\s*[»"]$/g, "").trim();

  return fields;
}

export async function runCartelOcr(
  file: File | Blob,
  onProgress?: (pct: number) => void,
): Promise<{ raw: string; fields: CartelFields }> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("fra", undefined, {
    logger: onProgress ? (m: { status: string; progress: number }) => { if (m.status === "recognizing text") onProgress(Math.round(m.progress * 100)); } : undefined,
  });
  try {
    const { data } = await worker.recognize(file);
    const raw = data.text || "";
    return { raw, fields: parseCartel(raw) };
  } finally {
    await worker.terminate();
  }
}
