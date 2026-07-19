import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { segmentToResource, isOwner } from "@/lib/access/share";
import { grantSchema, grantRemoveSchema } from "@/lib/validators/share";

type Params = { params: Promise<{ resource: string; id: string }> };

async function requireOwner(params: Params["params"], userId: string) {
  const { resource: seg, id } = await params;
  const resource = segmentToResource(seg);
  if (!resource) return { error: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
  if (!(await isOwner(resource, id, userId))) return { error: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
  return { resource, id };
}

// POST /api/share/[resource]/[id]/grants — ajoute/mets à jour un accès nominatif (owner only).
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const owned = await requireOwner(params, session.user.id);
  if ("error" in owned) return owned.error;

  const body = await req.json().catch(() => ({}));
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });

  const { userId, username, role } = parsed.data;
  const target = await db.user.findFirst({
    where: userId ? { id: userId } : { username: username!.toLowerCase() },
    select: { id: true, name: true, username: true, image: true },
  });
  if (!target) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  if (target.id === session.user.id) return NextResponse.json({ error: "Tu es déjà propriétaire" }, { status: 400 });

  const existing = await db.resourceGrant.findFirst({
    where: { resource: owned.resource, resourceId: owned.id, userId: target.id },
    select: { id: true },
  });
  if (existing) await db.resourceGrant.update({ where: { id: existing.id }, data: { role } });
  else await db.resourceGrant.create({ data: { resource: owned.resource, resourceId: owned.id, userId: target.id, role } });

  return NextResponse.json({ ok: true, grant: { user: target, role } });
}

// DELETE /api/share/[resource]/[id]/grants — retire un accès nominatif (owner only).
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const owned = await requireOwner(params, session.user.id);
  if ("error" in owned) return owned.error;

  const body = await req.json().catch(() => ({}));
  const parsed = grantRemoveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 });

  await db.resourceGrant.deleteMany({ where: { resource: owned.resource, resourceId: owned.id, userId: parsed.data.userId } });
  return NextResponse.json({ ok: true });
}
