// Fiche artiste (Phase 7, 2026-07-18) — recherche un artiste sur Wikipédia FR
// et renvoie de quoi construire une carte : nom, notice, portrait, URL. Appelé
// CÔTÉ SERVEUR (à la création du bloc), donc pas de souci CORS. Best-effort :
// renvoie null si rien trouvé, l'appelant gère.

export interface ArtistMeta {
  url: string;
  title: string;
  description: string | null;
  image: string | null;
  siteName: string;
}

// Wikipédia demande un User-Agent identifiable (les UA génériques sont
// throttlés). On reste correct et joignable.
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

export async function searchArtist(name: string): Promise<ArtistMeta | null> {
  const q = name.trim();
  if (!q) return null;

  // 1) Résolution nom → titre de page (recherche plein-texte).
  const search = (await fetchJson(
    `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=1&format=json`,
  )) as { query?: { search?: { title?: string }[] } } | null;
  const pageTitle = search?.query?.search?.[0]?.title;
  if (!pageTitle) return null;

  // 2) Résumé de la page (notice + portrait + URL canonique).
  const summary = (await fetchJson(
    `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`,
  )) as {
    title?: string;
    extract?: string;
    thumbnail?: { source?: string };
    originalimage?: { source?: string };
    content_urls?: { desktop?: { page?: string } };
  } | null;
  if (!summary) return null;

  const url = summary.content_urls?.desktop?.page ?? `https://fr.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`;
  return {
    url,
    title: summary.title ?? pageTitle,
    description: summary.extract ?? null,
    image: summary.thumbnail?.source ?? summary.originalimage?.source ?? null,
    siteName: "Wikipédia",
  };
}
