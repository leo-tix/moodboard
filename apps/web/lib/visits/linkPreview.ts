// Récupération des métadonnées d'un lien externe (bloc "lien" du carnet) et
// d'une vidéo YouTube (bloc "embed"). Côté serveur uniquement — appelé à la
// création d'un VisitEmbed. Pas de dépendance de parsing HTML : de simples
// regex sur les balises <meta> Open Graph suffisent pour une carte d'aperçu.

export interface LinkMeta {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const FETCH_TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 512 * 1024; // on ne lit que le <head> en pratique

// Garde-fou SSRF minimal : refuse tout ce qui n'est pas http(s) public
// (localhost, IP privées, .local…). L'utilisateur agit sur son propre carnet,
// mais on évite qu'une URL colle un scan du réseau interne de l'hôte.
export function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return false;
  // IPv4 privées / loopback / link-local
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x2F;/gi, "/")
    .trim();
}

// Extrait le contenu d'une balise <meta ...> par property/name (og:title,
// description, etc.) — l'ordre attribut/contenu variant selon les sites, on
// teste les deux dispositions.
function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${esc}["']`, "i"),
    ];
    for (const re of patterns) {
      const mm = html.match(re);
      if (mm && mm[1].trim()) return decodeEntities(mm[1]);
    }
  }
  return null;
}

// UA de navigateur réaliste : "MoodboardBot" se faisait bloquer/servir une
// page pauvre par beaucoup de sites (news notamment). Un UA Chrome récent
// récupère la vraie page (et donc les balises OG).
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Titres de pages "mur anti-bot" (Cloudflare, Datadome, etc.) — quand le site
// nous sert une interstitielle au lieu de l'article, son <title> est inutile
// (ex. Le Monde → "Client Challenge"). On le jette au profit du domaine.
const BOT_WALL_TITLE_RES = [
  /^client challenge$/i,
  /^just a moment/i,
  /^attention required/i,
  /cloudflare/i,
  /^access denied$/i,
  /verify(ing)? you are (a )?human/i,
  /^are you a (human|robot)/i,
  /bot verification/i,
  /pardon our interruption/i,
  /^security check$/i,
  /^one moment, please/i,
  /^please wait/i,
];

function looksLikeBotWall(title: string): boolean {
  return BOT_WALL_TITLE_RES.some((re) => re.test(title.trim()));
}

// Vérifie qu'une og:image se charge réellement (content-type image/*) — écarte
// les 404, les protections anti-hotlink côté serveur, les URLs cassées, pour ne
// pas afficher une vignette brisée dans la carte. On ne lit pas le corps.
async function imageLoads(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4500);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": BROWSER_UA, Accept: "image/*", Range: "bytes=0-0" },
    });
    const ct = r.headers.get("content-type") ?? "";
    return (r.ok || r.status === 206) && ct.startsWith("image/");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkMeta> {
  const empty: LinkMeta = { title: null, description: null, image: null, siteName: null };
  if (!isSafePublicUrl(rawUrl)) return empty;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(rawUrl, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
    });
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok || !ct.includes("html")) {
      return { ...empty, title: new URL(res.url || rawUrl).hostname };
    }
    // On ne lit que le début (le <head> contient les métadonnées).
    const buf = await res.arrayBuffer();
    const html = new TextDecoder("utf-8").decode(buf.slice(0, MAX_HTML_BYTES));

    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    let title =
      metaContent(html, ["og:title", "twitter:title"]) ?? (titleTag ? decodeEntities(titleTag[1]) : null);
    // Mur anti-bot → titre inutile : on retombe sur le domaine (côté UI).
    if (title && looksLikeBotWall(title)) title = null;

    const description = metaContent(html, ["og:description", "twitter:description", "description"]);
    let image = metaContent(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]);
    const siteName = metaContent(html, ["og:site_name"]) ?? new URL(res.url || rawUrl).hostname;

    // Résout une og:image relative contre l'URL finale, puis vérifie qu'elle
    // se charge vraiment (sinon vignette brisée dans la carte).
    if (image) {
      try {
        image = new URL(image, res.url || rawUrl).toString();
      } catch {
        image = null;
      }
      if (image && !(await imageLoads(image))) image = null;
    }
    return { title, description, image, siteName };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

// ── YouTube ─────────────────────────────────────────────────────────────────

export function parseYouTubeId(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const idOk = (v: string | null): string | null => (v && /^[\w-]{11}$/.test(v) ? v : null);

  if (host === "youtu.be") return idOk(u.pathname.slice(1).split("/")[0]);
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") return idOk(u.searchParams.get("v"));
    const seg = u.pathname.split("/").filter(Boolean);
    if (seg[0] === "embed" || seg[0] === "shorts" || seg[0] === "v" || seg[0] === "live") return idOk(seg[1] ?? null);
  }
  return null;
}

export async function fetchYouTubeMeta(videoId: string): Promise<LinkMeta> {
  const image = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const base: LinkMeta = { title: null, description: null, image, siteName: "YouTube" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: ctrl.signal },
    );
    if (res.ok) {
      const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
      return {
        title: data.title ?? null,
        description: data.author_name ?? null,
        image: data.thumbnail_url ?? image,
        siteName: "YouTube",
      };
    }
  } catch {
    // oEmbed indisponible → on garde juste la miniature.
  } finally {
    clearTimeout(timer);
  }
  return base;
}
