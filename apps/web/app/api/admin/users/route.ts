import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/current";
import { createProfileSchema } from "@/lib/validators/auth";
import { canAllocateQuota, getStorageQuota, QUOTA } from "@/lib/storage/quota";

// GET /api/admin/users — liste des profils avec usage + quota (admin only)
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });

  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      storageQuotaBytes: true,
      createdAt: true,
    },
  });

  // Usage réel par profil (peu de profils → coût négligeable)
  const withUsage = await Promise.all(
    users.map(async (u) => {
      const q = await getStorageQuota(u.id);
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        quotaBytes: Number(u.storageQuotaBytes),
        usedBytes: q.usedBytes,
        createdAt: u.createdAt.toISOString(),
      };
    })
  );

  const allocated = withUsage.reduce((s, u) => s + u.quotaBytes, 0);

  return NextResponse.json({
    users: withUsage,
    global: {
      maxBytes: QUOTA.MAX_STORAGE_BYTES,
      allocatedBytes: allocated,
      availableBytes: Math.max(0, QUOTA.MAX_STORAGE_BYTES - allocated),
    },
  });
}

// POST /api/admin/users — crée un profil (admin only)
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Réservé à l'administrateur" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = createProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { email, password, name, quotaBytes } = parsed.data;

  // Email unique
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: "Un profil avec cet email existe déjà" }, { status: 409 });
  }

  // Garde-fou : la somme des quotas ne doit pas dépasser le quota global
  const { ok, availableBytes } = await canAllocateQuota(quotaBytes);
  if (!ok) {
    return NextResponse.json(
      {
        error: `Quota trop élevé. Il reste ${formatGb(availableBytes)} Go à distribuer sur le bucket.`,
        availableBytes,
      },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.create({
    data: {
      email,
      passwordHash,
      name: name?.trim() || null,
      role: "USER",
      storageQuotaBytes: BigInt(quotaBytes),
    },
    select: { id: true, email: true, name: true, role: true, storageQuotaBytes: true, createdAt: true },
  });

  return NextResponse.json(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      quotaBytes: Number(user.storageQuotaBytes),
      usedBytes: 0,
      createdAt: user.createdAt.toISOString(),
    },
    { status: 201 }
  );
}

function formatGb(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}
