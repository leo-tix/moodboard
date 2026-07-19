import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { segmentToResource, isOwner, updateVisibility, getVisibility } from "@/lib/access/share";
import { visibilitySchema } from "@/lib/validators/share";

type Params = { params: Promise<{ resource: string; id: string }> };

// GET /api/share/[resource]/[id] — état de partage (owner only) : visibilité + grants.
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const { resource: seg, id } = await params;
  const resource = segmentToResource(seg);
  if (!resource) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  if (!(await isOwner(resource, id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const [visibility, grants] = await Promise.all([
    getVisibility(resource, id),
    db.resourceGrant.findMany({
      where: { resource, resourceId: id },
      select: { role: true, user: { select: { id: true, name: true, username: true, image: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return NextResponse.json({ visibility, grants });
}

// PATCH /api/share/[resource]/[id] — change la visibilité (owner only).
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const { resource: seg, id } = await params;
  const resource = segmentToResource(seg);
  if (!resource) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  if (!(await isOwner(resource, id, session.user.id))) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = visibilitySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });

  await updateVisibility(resource, id, parsed.data.visibility);
  return NextResponse.json({ ok: true, visibility: parsed.data.visibility });
}
