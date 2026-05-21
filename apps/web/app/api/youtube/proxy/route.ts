import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export const maxDuration = 30;

// Allowlist: only proxy YouTube CDN domains
const ALLOWED_HOSTS = ["googlevideo.com", "youtube.com", "ytimg.com"];

function isAllowedUrl(raw: string): boolean {
  try {
    const { hostname } = new URL(raw);
    return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return new NextResponse("Non autorisé", { status: 401 });

  const encodedUrl = req.nextUrl.searchParams.get("url");
  if (!encodedUrl) return new NextResponse("Paramètre url manquant", { status: 400 });

  const targetUrl = decodeURIComponent(encodedUrl);

  if (!isAllowedUrl(targetUrl)) {
    return new NextResponse("URL non autorisée", { status: 403 });
  }

  const rangeHeader = req.headers.get("range");

  const upstreamHeaders: Record<string, string> = {
    // Mimic a real browser request so YouTube CDN serves the content
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Referer": "https://www.youtube.com/",
    "Origin": "https://www.youtube.com",
  };

  if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

  try {
    const upstream = await fetch(targetUrl, { headers: upstreamHeaders });

    const responseHeaders: Record<string, string> = {
      "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
      // Must declare byte-range support so <video> can seek
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    };

    const contentRange = upstream.headers.get("content-range");
    if (contentRange) responseHeaders["Content-Range"] = contentRange;

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) responseHeaders["Content-Length"] = contentLength;

    return new NextResponse(upstream.body, {
      status: upstream.status, // 200 or 206 Partial Content
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[YouTube proxy]", error);
    return new NextResponse("Erreur proxy", { status: 502 });
  }
}
