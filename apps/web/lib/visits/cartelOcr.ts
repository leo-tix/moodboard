// OCR d'un cartel de musée → pré-remplissage des champs (Phase 4, 2026-07-18 ;
// parseur repensé 2026-07-19). tesseract.js est importé DYNAMIQUEMENT (~lourd,
// wasm + données de langue chargées à la demande) : hors du bundle initial.
// Tout est best-effort : en cas d'échec on retombe sur la saisie manuelle.
//
// Le découpage en champs gère les DEUX conventions de cartel :
//  · titre-d'abord : TITRE → (année) → Artiste (dates de vie) → technique → notes
//  · artiste-d'abord : Artiste → dates de vie → Titre, année → technique → dims
// et ignore le bruit (galerie, n° d'inventaire, provenance, édition, doublon EN).
// Validé sur 7 cartels réels (voir scratchpad cartelParse.test.mjs).

export interface CartelFields {
  artworkTitle?: string;
  artist?: string;
  dateText?: string;
  medium?: string;
  dimensions?: string;
  notes?: string;
}

const MEDIUM_KEYWORDS = [
  "huile", "toile", "bronze", "marbre", "aquarelle", "gouache", "encre",
  "fusain", "tempera", "acrylique", "gravure", "lithographie", "eau-forte",
  "photographie", "épreuve", "terre cuite", "plâtre", "bois", "pastel",
  "sanguine", "craie", "papier", "panneau", "cuivre", "argent",
  "céramique", "porcelaine", "faïence", "verre", "tapisserie", "estampe",
  "linogravure", "sérigraphie", "collage", "vélin", "marouflé",
  "oil on canvas", "oil on", "acrylic", "engraving", "etching", "print on",
];

const NOISE_RES: RegExp[] = [
  /^galerie\b/i, /\bgallery\b/i, /&\s*co\.?/i,
  /^collection particuli/i, /^private collection/i, /^coll\.\s/i,
  /^don\b/i, /\bachat\b/i, /\bpurchase\b/i, /^mnbaq/i, /^mus[ée]e\b/i, /^museum\b/i,
  /^\(?\d{3,4}\.\d+\)?$/,          // inventaire (1934.148)
  /^[A-Z]{1,3}\s?\d{3,}[A-Z]?$/,   // cote type W21839
  /estampe num[ée]rot/i, /numbered/i, /^[ée]dition\b/i,
];

const YEAR = "(?:1[0-9]{3}|20[0-9]{2})";
const DASH = "[-–—]";
const dimRe = /\d+([.,]\d+)?\s*[x×]\s*\d+([.,]\d+)?(\s*[x×]\s*\d+([.,]\d+)?)?\s*(cm|mm|m)\b/i;
const lifeInline = new RegExp(`^(.+?)\\s*[(（]\\s*${YEAR}\\s*${DASH}\\s*${YEAR}\\s*[)）]\\s*$`);
const lifeStandalone = new RegExp(`^[(（]?\\s*${YEAR}\\s*${DASH}\\s*${YEAR}\\s*[)）]?$`);
const lifeWithPlaces = new RegExp(`${YEAR}\\D{0,40}${DASH}\\D{0,40}${YEAR}`);
const parenYear = new RegExp(`^[(（]\\s*(${YEAR}(?:\\s*${DASH}\\s*${YEAR})?)\\s*[)）]$`);
const standaloneYear = new RegExp(`^[(（]?\\s*(${YEAR})\\s*[)）]?$`);
const trailingYear = new RegExp(`[,]\\s*(${YEAR})\\s*$`);

const isNoise = (l: string) => NOISE_RES.some((re) => re.test(l.trim()));
const isLifeLine = (l: string) => lifeStandalone.test(l) || (lifeWithPlaces.test(l) && l.length < 60 && !dimRe.test(l));

// Détection d'un mot-clé « technique » en respectant les frontières de mot
// (Unicode) — sinon « étoiles » contiendrait « toile ».
function hasMediumKeyword(line: string): boolean {
  const low = line.toLowerCase();
  return MEDIUM_KEYWORDS.some((k) => {
    let from = 0;
    let idx: number;
    while ((idx = low.indexOf(k, from)) !== -1) {
      const before = low[idx - 1];
      const after = low[idx + k.length];
      const okB = before === undefined || !/\p{L}/u.test(before);
      const okA = after === undefined || !/\p{L}/u.test(after);
      if (okB && okA) return true;
      from = idx + 1;
    }
    return false;
  });
}

function looksLikeName(l: string): boolean {
  const s = l.trim();
  if (s.length > 40 || /\d/.test(s) || /[,;:"]/.test(s)) return false;
  if (hasMediumKeyword(s)) return false;
  return /^\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}?[\p{L}'’.-]+){1,3}$/u.test(s);
}

// Cartels bilingues (FR puis EN) : la 1re ligne (artiste) réapparaît → on coupe.
function dropBilingualDuplicate(lines: string[]): string[] {
  if (lines.length < 4) return lines;
  const first = lines[0].toLowerCase();
  for (let i = 2; i < lines.length; i++) {
    if (lines[i].toLowerCase() === first) return lines.slice(0, i);
  }
  return lines;
}

export function parseCartel(raw: string): CartelFields {
  let lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 1);
  lines = dropBilingualDuplicate(lines);
  const fields: CartelFields = {};
  const used = new Set<number>();

  // Dimensions (n'importe où)
  let dimsIdx = -1;
  lines.forEach((l, i) => {
    if (dimsIdx === -1 && dimRe.test(l)) { fields.dimensions = l.match(dimRe)![0].trim(); dimsIdx = i; }
  });

  // Technique
  let mediumIdx = -1;
  lines.forEach((l, i) => { if (mediumIdx === -1 && hasMediumKeyword(l) && !isNoise(l)) mediumIdx = i; });
  if (mediumIdx !== -1) {
    let med = lines[mediumIdx];
    const hadSeries = /de la s[ée]rie/i.test(med);
    med = med
      .replace(dimRe, "")
      .replace(/,?\s*format\b/i, "")
      .replace(/,?\s*issue de la s[ée]rie.*$/i, "")
      .replace(/,?\s*de la s[ée]rie.*$/i, "")
      .replace(/[,;]\s*$/, "")
      .trim();
    fields.medium = med;
    used.add(mediumIdx);
    if (hadSeries && mediumIdx + 1 < lines.length) used.add(mediumIdx + 1); // nom de série
  }

  // Artiste + dates de vie
  let artistIdx = -1;
  let lifeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(lifeInline);
    if (m) { fields.artist = m[1].trim(); artistIdx = i; break; }
  }
  if (artistIdx === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      if (isLifeLine(lines[i])) {
        lifeIdx = i;
        for (let j = i - 1; j >= 0; j--) {
          if (!used.has(j) && !isNoise(lines[j])) { fields.artist = lines[j].trim(); artistIdx = j; break; }
        }
        if (artistIdx !== -1) break;
      }
    }
  }
  if (artistIdx === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i) || isNoise(lines[i])) continue;
      if (looksLikeName(lines[i])) { fields.artist = lines[i].trim(); artistIdx = i; break; }
    }
  }
  if (artistIdx !== -1) used.add(artistIdx);
  if (lifeIdx !== -1) used.add(lifeIdx);

  // Titre + convention (titre-d'abord si un candidat précède l'artiste)
  const isCandidate = (i: number) =>
    i >= 0 && i < lines.length && !used.has(i) && !isNoise(lines[i]) && !isLifeLine(lines[i]) && i !== mediumIdx && i !== dimsIdx;
  let titleIdx = -1;
  for (let i = 0; i < artistIdx; i++) { if (isCandidate(i)) { titleIdx = i; break; } }
  if (titleIdx === -1) {
    const start = Math.max(artistIdx, lifeIdx) + 1;
    for (let i = start; i < lines.length; i++) { if (isCandidate(i)) { titleIdx = i; break; } }
  }
  let dateIdx = -1;
  if (titleIdx !== -1) {
    let title = lines[titleIdx];
    const ty = title.match(trailingYear);
    if (ty) { fields.dateText = ty[1]; title = title.replace(trailingYear, "").trim(); }
    fields.artworkTitle = title.replace(/^[«"]\s*|\s*[»"]$/g, "").trim();
    used.add(titleIdx);
  }
  // Date de l'œuvre si pas encore trouvée
  if (!fields.dateText) {
    for (let i = 0; i < lines.length; i++) {
      if (!used.has(i) && /^(entre|between)\b/i.test(lines[i])) { fields.dateText = lines[i].trim(); dateIdx = i; break; }
    }
  }
  if (!fields.dateText && titleIdx !== -1) {
    const nx = lines[titleIdx + 1];
    if (nx && parenYear.test(nx)) { fields.dateText = nx.match(parenYear)![1]; dateIdx = titleIdx + 1; }
  }
  if (!fields.dateText && titleIdx !== -1) {
    for (let i = titleIdx + 1; i < lines.length; i++) {
      if (used.has(i)) continue;
      if (standaloneYear.test(lines[i])) { fields.dateText = lines[i].match(standaloneYear)![1]; dateIdx = i; break; }
      if (!isNoise(lines[i]) && i !== mediumIdx && i !== dimsIdx) break;
    }
  }
  if (dateIdx !== -1) used.add(dateIdx);

  // Notes : contenu restant (descriptions, citations)
  const notes = lines
    .filter((l, i) => !used.has(i) && !isNoise(l) && !isLifeLine(l) && !standaloneYear.test(l) && i !== dimsIdx)
    .map((l) => l.trim());
  if (notes.length) fields.notes = notes.join("\n");

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
