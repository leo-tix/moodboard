// Fiche Wikipédia (« fiche wiki » — artiste, mouvement, lieu, œuvre… 2026-07-19).
// Interroge Wikipédia FR et renvoie de quoi construire une carte structurée :
// nom, courte description (« peintre français »), notice (1er paragraphe),
// portrait, URL. Appelé CÔTÉ SERVEUR (pas de souci CORS). Best-effort : null si
// rien trouvé. Les suggestions de recherche, elles, sont côté client
// (opensearch avec origin=*), voir WikiSearchForm.

export interface WikiMeta {
  url: string;
  title: string;       // nom / titre de la page
  shortDesc: string | null; // description courte Wikipédia (« peintre français »)
  extract: string | null;   // 1er paragraphe
  image: string | null;
}

const WIKI_UA = "MoodboardVisitJournal/1.0 (https://moodboard.leotix.fr)";
const TIMEOUT_MS = 6000;

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

// Résumé REST d'une page (titre exact) → nom, description courte, extrait, image.
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

  const url = summary.content_urls?.desktop?.page ?? `https://fr.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`;
  return {
    url,
    title: summary.title ?? pageTitle,
    shortDesc: summary.description ?? null,
    extract: summary.extract ?? null,
    image: summary.thumbnail?.source ?? summary.originalimage?.source ?? null,
  };
}

// Recherche plein-texte (nom → 1er résultat) puis résumé. Utilisé si l'appelant
// n'a pas déjà choisi un titre exact dans les suggestions.
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
