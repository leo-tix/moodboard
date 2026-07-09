import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/current";
import { deleteFromR2 } from "@/lib/storage/r2";
import { updateProfileSchema } from "@/lib/validators/auth";
import { canAllocateQuota, getStorageQuota } from "@/lib/storage/quota";

interface Params { params: Promise<{ id: string }> }

// PATCH /api/admin/users/[id] — modifie quota / nom / mot de passe (admin only)
export async function PATCH(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });

  const { name, quotaBytes, password } = parsed.data;
  const data: Record<string, unknown> = {};

  if (name !== undefined) data.name = name?.trim() || null;
  if (password !== undefined) data.passwordHash = await bcrypt.hash(password, 12);

  if (quotaBytes !== undefined) {
    // Le nouveau quota ne peut pas descendre sous l'usage réel du profil
    const usage = await getStorageQuota(id);
    if (quotaBytes < usage.usedBytes) {
      return NextResponse.json(
        { error: `Ce profil utilise déjà ${usage.formatted.used}. Le quota ne peut pas être inférieur.` },
        { status: 400 }
      );
    }
    // Garde-fou global (en excluant le quota actuel de ce profil)
    const { ok, availableBytes } = await canAllocateQuota(quotaBytes, id);
    if (!ok) {
      return NextResponse.json(
        {
          error: `Quota trop élevé. Il reste ${(availableBytes / 1024 ** 3).toFixed(2)} Go à distribuer.`,
          availableBytes,
        },
        { status: 400 }
      );
    }
    data.storageQuotaBytes = BigInt(quotaBytes);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Rien à mettre à jour" }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true, storageQuotaBytes: true, createdAt: true },
  });
  const q = await getStorageQuota(updated.id);

  return NextResponse.json({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    quotaBytes: Number(updated.storageQuotaBytes),
    usedBytes: q.usedBytes,
    createdAt: updated.createdAt.toISOString(),
  });
}

// DELETE /api/admin/users/[id] — supprime un profil + toutes ses données + objets R2
export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });

  const { id } = await params;

  if (id === admin.id) {
    return NextResponse.json(
      { error: "Tu ne peux pas supprimer ton propre compte admin ici." },
      { status: 400 }
    );
  }

  const target = await db.user.findUnique({ where: { id }, select: { id: true, image: true } });
  if (!target) return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });

  // Récupère les clés R2 AVANT la suppression (le cascade DB efface les lignes Image)
  const images = await db.image.findMany({
    where: { inspiration: { userId: id } },
    select: { storageKey: true, thumbnailKey: true },
  });
  const keys = images.flatMap((img) =>
    [img.storageKey, img.thumbnailKey].filter(Boolean) as string[]
  );
  if (target.image) keys.push(target.image);

  // Supprime le profil — le cascade efface inspirations, images, collections,
  // moodboards, folders, visits, tags, apiTokens (relations onDelete: Cascade).
  await db.user.delete({ where: { id } });

  // Nettoyage R2 non-bloquant
  if (keys.length > 0) {
    await Promise.allSettled(keys.map((k) => deleteFromR2(k)));
  }

  return NextResponse.json({ success: true, deletedObjects: keys.length });
}
