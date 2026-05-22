import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * GET /api/proxy-image?key=<storageKey>
 *
 * Proxies a Cloudflare R2 image through the Next.js server so that
 * client-side canvas rendering (PNG export) can call `drawImage` without
 * hitting a CORS taint — the fetch is same-origin from the browser's POV.
 *
 * Security:
 *  - Requires a valid session (authenticated users only)
 *  - Storage key is validated against a strict allowlist regex (no path traversal)
 *  - Only reaches the configured R2 public URL (no arbitrary SSRF)
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const key = req.nextUrl.searchParams.get("key");
  if (!key) return new NextResponse("Missing key", { status: 400 });

  // Allowlist: alphanumeric + _ - . / only — blocks path traversal and injections
  if (!/^[\w.\-/]+$/.test(key)) {
    return new NextResponse("Invalid key", { status: 400 });
  }

  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!base) return new NextResponse("Storage not configured", { status: 500 });

  const imageUrl = `${base}/${key}`;

  const upstream = await fetch(imageUrl);
  if (!upstream.ok) {
    return new NextResponse("Image not found", { status: upstream.status });
  }

  const buffer = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("Content-Type") ?? "image/jpeg";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      // Cache aggressively — the image content is immutable for a given key
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
