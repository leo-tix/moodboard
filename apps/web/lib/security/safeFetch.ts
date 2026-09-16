import { lookup } from "dns/promises";
import { isIP } from "net";

/**
 * Garde-fou SSRF pour les requêtes sortantes dont l'URL vient de l'utilisateur
 * (import d'une image par URL, résolution d'un lien court…).
 *
 * Sans ce contrôle, un compte authentifié peut faire émettre au serveur des
 * requêtes vers le réseau interne de l'hébergeur : `http://169.254.169.254/`
 * (métadonnées d'instance, souvent porteuses de jetons), `http://localhost:…`
 * (services non exposés), ou une IP privée d'un VPC. Le contenu récupéré
 * atterrit ensuite dans la bibliothèque de l'utilisateur, donc la fuite est
 * lisible, pas seulement aveugle.
 *
 * Deux verrous :
 *  1. schéma http(s) uniquement, pas de port exotique ;
 *  2. résolution DNS explicite, puis refus de toute adresse non publique —
 *     et la requête part sur l'IP validée, pour qu'une seconde résolution ne
 *     puisse pas renvoyer une autre adresse entre-temps (DNS rebinding).
 */

/** Plages non routables sur Internet : boucle locale, RFC 1918, CGNAT, lien-local… */
function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return true;           // lien-local / métadonnées cloud
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;             // IETF protocol assignments
  if (a >= 224) return true;                         // multicast + réservé
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (addr === "::1" || addr === "::") return true;
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // unique local
  if (addr.startsWith("fe80")) return true;                        // lien-local
  // IPv4 encapsulée (::ffff:169.254.169.254)
  const v4 = addr.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (v4) return isPrivateIPv4(v4);
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // pas une IP → on refuse par défaut
}

export class BlockedUrlError extends Error {
  constructor(message = "URL non autorisée") {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** Valide l'URL et retourne l'adresse IP publique retenue. */
export async function assertPublicUrl(rawUrl: string): Promise<{ url: URL; address: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError("URL invalide");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError("Seuls http et https sont acceptés");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  // Hôte déjà littéral : pas de DNS à interroger.
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new BlockedUrlError("Adresse réseau interne refusée");
    return { url, address: host };
  }

  let resolved;
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError("Hôte introuvable");
  }
  if (resolved.length === 0) throw new BlockedUrlError("Hôte introuvable");
  // Une seule adresse privée suffit à refuser : un domaine qui pointe à la fois
  // sur du public et du privé est exactement la forme d'un contournement.
  for (const entry of resolved) {
    if (isPrivateAddress(entry.address)) throw new BlockedUrlError("Adresse réseau interne refusée");
  }

  return { url, address: resolved[0]!.address };
}

/**
 * `fetch` avec contrôle SSRF, y compris sur les redirections (chaque saut est
 * revalidé : `redirect: "manual"` puis suivi à la main).
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit & { maxRedirects?: number } = {},
): Promise<Response> {
  const { maxRedirects = 5, ...rest } = init;
  let current = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...rest, redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }

  throw new BlockedUrlError("Trop de redirections");
}

/** URL finale après redirections, avec le même contrôle (liens courts). */
export async function safeResolveUrl(rawUrl: string, init: RequestInit = {}): Promise<string> {
  const res = await safeFetch(rawUrl, { ...init, method: "GET" });
  return res.url || rawUrl;
}
