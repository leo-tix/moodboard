import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getStorageQuota, QUOTA } from "@/lib/storage/quota";
import { ProfilesManager, type ProfileRow } from "@/components/settings/ProfilesManager";
import { OrphanedFilesPanel } from "@/components/settings/OrphanedFilesPanel";

export const dynamic = "force-dynamic";

export default async function ProfilesPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/settings/account");

  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true, storageQuotaBytes: true, createdAt: true },
  });

  const rows: ProfileRow[] = await Promise.all(
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

  const allocated = rows.reduce((s, u) => s + u.quotaBytes, 0);

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-sm font-medium text-[var(--text-primary)] mb-1">Profils</h2>
      <p className="text-xs text-[var(--text-tertiary)] mb-6">
        Crée des profils et répartis le stockage. La somme des quotas ne peut pas
        dépasser le quota global du bucket R2.
      </p>
      <ProfilesManager
        initialUsers={rows}
        adminId={admin.id}
        global={{
          maxBytes: QUOTA.MAX_STORAGE_BYTES,
          allocatedBytes: allocated,
          availableBytes: Math.max(0, QUOTA.MAX_STORAGE_BYTES - allocated),
        }}
      />

      <div className="mt-8">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1">Gestion des fichiers</h3>
        <p className="text-xs text-[var(--text-tertiary)] mb-3">
          Réconciliation stockage R2 — porte sur le bucket entier, tous profils confondus.
        </p>
        <OrphanedFilesPanel />
      </div>
    </div>
  );
}
