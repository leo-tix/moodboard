import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getStorageQuota } from "@/lib/storage/quota";
import { AccountSettings } from "@/components/settings/AccountSettings";

export default async function AccountSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [user, storage] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, image: true, createdAt: true },
    }),
    getStorageQuota(),
  ]);

  if (!user) redirect("/login");

  return (
    <div className="p-6 max-w-xl">
      <h2 className="text-sm font-medium text-[var(--text-primary)] mb-6">Compte</h2>
      <AccountSettings
        initialName={user.name ?? ""}
        initialEmail={user.email}
        initialImage={user.image}
        memberSince={user.createdAt.toISOString()}
        storage={{
          usedBytes: storage.usedBytes,
          maxBytes: storage.maxBytes,
          usedPercent: storage.usedPercent,
          isNearLimit: storage.isNearLimit,
          formatted: storage.formatted,
        }}
      />
    </div>
  );
}
