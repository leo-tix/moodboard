// Fiche Wikipédia (« fiche wiki » — artiste, mouvement, lieu, œuvre… 2026-07-19).
// Résumé texte (REST) + INFOBOX STRUCTURÉE via Wikidata (naissance/décès + lieux,
// nationalité, activité, mouvement, genres, œuvres notables). Appelé CÔTÉ
// SERVEUR. Best-effort : les données structurées sont optionnelles (null si
// Wikidata échoue), le résumé texte reste renvoyé.

export interface WikiStructured {
  birth?: { date?: string; place?: string };
  death?: { date?: string; place?: string };
  nationality?: string[];
  occupation?: string[];
  movement?: string[];
  genre?: string[];
  notableWorks?: string[];
}

export interface WikiMeta {
  url: string;
  title: string;
  shortDesc: string | null; // description courte (« peintre français »)
  extract: string | null;   // 1er paragraphe
  image: string | null;
  structured: WikiStructured | null;
}

const WIKI_UA = "MoodboardVisitJournal/1.0 (https://moodboard.leotix.fr)";
const TIMEOUT_MS = 7000;

async function fetchJson(url: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": WIKI_UA, Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Wikidata ─────────────────────────────────────────────────────────────────

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function formatWikidataTime(v: { time?: string; precision?: number } | undefined): string | undefined {
  if (!v?.time) return undefined;
  const m = v.time.match(/^([+-])(\d+)-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const bce = m[1] === "-";
  const year = parseInt(m[2], 10);
  const month = parseInt(m[3], 10);
  const day = parseInt(m[4], 10);
  const suffix = bce ? " av. J.-C." : "";
  const prec = v.precision ?? 11;
  if (prec >= 11 && day > 0) return `${day} ${MONTHS_FR[month - 1] ?? ""} ${year}${suffix}`.trim();
  if (prec === 10 && month > 0) return `${MONTHS_FR[month - 1] ?? ""} ${year}${suffix}`.trim();
  return `${year}${suffix}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function firstTime(claims: any, prop: string): { time?: string; precision?: number } | undefined {
  return claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;
}
function itemIds(claims: any, prop: string, max: number): string[] {
  const arr = claims?.[prop];
  if (!Array.isArray(arr)) return [];
  const ids: string[] = [];
  for (const c of arr) {
    const id = c?.mainsnak?.datavalue?.value?.id;
    if (typeof id === "string" && !ids.includes(id)) ids.push(id);
    if (ids.length >= max) break;
  }
  return ids;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function fetchStructured(qid: string): Promise<WikiStructured | null> {
  const entity = (await fetchJson(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json&origin=*`,
  )) as { entities?: Record<string, { claims?: unknown }> } | null;
  const claims = entity?.entities?.[qid]?.claims;
  if (!claims) return null;

  const birthPlace = itemIds(claims, "P19", 1);
  const deathPlace = itemIds(claims, "P20", 1);
  const nationality = itemIds(claims, "P27", 3);
  const occupation = itemIds(claims, "P106", 3);
  const movement = itemIds(claims, "P135", 3);
  const genre = itemIds(claims, "P136", 3);
  const works = itemIds(claims, "P800", 4);

  const allIds = [...birthPlace, ...deathPlace, ...nationality, ...occupation, ...movement, ...genre, ...works];
  const labels: Record<string, string> = {};
  if (allIds.length) {
    const uniq = [...new Set(allIds)];
    const res = (await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${uniq.join("|")}&props=labels&languages=fr&format=json&origin=*`,
    )) as { entities?: Record<string, { labels?: { fr?: { value?: string } } }> } | null;
    for (const id of uniq) {
      const l = res?.entities?.[id]?.labels?.fr?.value;
      if (l) labels[id] = l;
    }
  }
  const lbl = (ids: string[]) => ids.map((id) => labels[id]).filter(Boolean);

  const birthDate = formatWikidataTime(firstTime(claims, "P569"));
  const deathDate = formatWikidataTime(firstTime(claims, "P570"));
  const s: WikiStructured = {};
  if (birthDate || birthPlace.length) s.birth = { date: birthDate, place: lbl(birthPlace)[0] };
  if (deathDate || deathPlace.length) s.death = { date: deathDate, place: lbl(deathPlace)[0] };
  if (nationality.length) s.nationality = lbl(nationality);
  if (occupation.length) s.occupation = lbl(occupation);
  if (movement.length) s.movement = lbl(movement);
  if (genre.length) s.genre = lbl(genre);
  if (works.length) s.notableWorks = lbl(works);
  return Object.keys(s).length ? s : null;
}

async function getQid(pageTitle: string): Promise<string | null> {
  const data = (await fetchJson(
    `https://fr.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&titles=${encodeURIComponent(pageTitle)}&format=json&origin=*`,
  )) as { query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> } } | null;
  const pages = data?.query?.pages;
  if (!pages) return null;
  for (const p of Object.values(pages)) {
    if (p?.pageprops?.wikibase_item) return p.pageprops.wikibase_item;
  }
  return null;
}

// ── Résumé + infobox ─────────────────────────────────────────────────────────

export async function fetchWikiSummary(pageTitle: string): Promise<WikiMeta | null> {
  const summary = (await fetchJson(
    `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`,
  )) as {
    title?: string;
    description?: string;
    extract?: string;
    thumbnail?: { source?: string };
    originalimage?: { source?: string };
    content_urls?: { desktop?: { page?: string } };
    type?: string;
  } | null;
  if (!summary || summary.type === "disambiguation") return null;

  const canonicalTitle = summary.title ?? pageTitle;
  const url = summary.content_urls?.desktop?.page ?? `https://fr.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`;

  // Infobox structurée (best-effort, ne bloque pas si indisponible).
  let structured: WikiStructured | null = null;
  try {
    const qid = await getQid(canonicalTitle);
    if (qid) structured = await fetchStructured(qid);
  } catch {
    structured = null;
  }

  return {
    url,
    title: canonicalTitle,
    shortDesc: summary.description ?? null,
    extract: summary.extract ?? null,
    image: summary.thumbnail?.source ?? summary.originalimage?.source ?? null,
    structured,
  };
}

export async function searchWiki(query: string): Promise<WikiMeta | null> {
  const q = query.trim();
  if (!q) return null;
  const search = (await fetchJson(
    `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=1&format=json`,
  )) as { query?: { search?: { title?: string }[] } } | null;
  const pageTitle = search?.query?.search?.[0]?.title;
  if (!pageTitle) return null;
  return fetchWikiSummary(pageTitle);
}
