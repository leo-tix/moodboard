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
        // Certains sites renvoient une page pauvre sans UA de navigateur.
        "User-Agent": "Mozilla/5.0 (compatible; MoodboardBot/1.0; +https://moodboard.leotix.fr)",
        Accept: "text/html,application/xhtml+xml",
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
    const title =
      metaContent(html, ["og:title", "twitter:title"]) ?? (titleTag ? decodeEntities(titleTag[1]) : null);
    const description = metaContent(html, ["og:description", "twitter:description", "description"]);
    let image = metaContent(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]);
    const siteName = metaContent(html, ["og:site_name"]) ?? new URL(res.url || rawUrl).hostname;

    // Résout une og:image relative contre l'URL finale.
    if (image) {
      try {
        image = new URL(image, res.url || rawUrl).toString();
      } catch {
        image = null;
      }
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
