import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/current";

// Relais admin-only vers POST/GET/DELETE /admin/cookies(/status) du worker
// VPS (apps/gif-worker) — permet de déposer les cookies yt-dlp (Instagram/
// YouTube, voir README du worker) depuis Réglages → Import vidéo, sans scp
// manuel. Le contenu du cookies.txt transite UNIQUEMENT ici (jamais stocké
// en base) : requireAdmin côté session, puis jeton statique GIF_WORKER_TOKEN
// côté worker — jamais exposé au navigateur.
const PLATFORMS = ["youtube", "instagram"] as const;
type Platform = (typeof PLATFORMS)[number];

function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

function workerConfig(): { origin: string; secret: string } | null {
  const workerUrl = process.env.GIF_WORKER_URL;
  const secret = process.env.GIF_WORKER_TOKEN;
  if (!workerUrl || !secret) return null;
  return { origin: new URL(workerUrl).origin, secret };
}

const UNAVAILABLE = NextResponse.json(
  { error: "Service de conversion GIF non configuré." },
  { status: 503 },
);

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });

  const worker = workerConfig();
  if (!worker) return UNAVAILABLE;

  try {
    const res = await fetch(`${worker.origin}/admin/cookies/status`, {
      headers: { Authorization: `Bearer ${worker.secret}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("[admin/video-link/cookies GET]", res.status, await res.text().catch(() => ""));
      return NextResponse.json({ error: "Échec de lecture du statut." }, { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    console.error("[admin/video-link/cookies GET]", err);
    return NextResponse.json({ error: "Service de téléchargement vidéo indisponible." }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const platform = body?.platform;
  const content = typeof body?.content === "string" ? body.content : "";
  if (!isPlatform(platform)) {
    return NextResponse.json({ error: "Plateforme invalide." }, { status: 400 });
  }
  if (!content.trim()) {
    return NextResponse.json({ error: "Colle le contenu du fichier cookies.txt." }, { status: 400 });
  }

  const worker = workerConfig();
  if (!worker) return UNAVAILABLE;

  try {
    const res = await fetch(`${worker.origin}/admin/cookies`, {
      method: "POST",
      headers: { Authorization: `Bearer ${worker.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ platform, content }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}) as { error?: string });
    if (!res.ok) {
      console.error("[admin/video-link/cookies POST]", res.status, data);
      return NextResponse.json(
        { error: data.error === "too_large" ? "Fichier trop volumineux." : "Échec de l'enregistrement." },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/video-link/cookies POST]", err);
    return NextResponse.json({ error: "Service de téléchargement vidéo indisponible." }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });

  const platform = req.nextUrl.searchParams.get("platform");
  if (!isPlatform(platform)) {
    return NextResponse.json({ error: "Plateforme invalide." }, { status: 400 });
  }

  const worker = workerConfig();
  if (!worker) return UNAVAILABLE;

  try {
    const res = await fetch(`${worker.origin}/admin/cookies/${platform}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${worker.secret}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return NextResponse.json({ error: "Échec de suppression." }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Service de téléchargement vidéo indisponible." }, { status: 503 });
  }
}
