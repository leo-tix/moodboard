import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getStorageQuota } from "@/lib/storage/quota";
import { AccountSettings } from "@/components/settings/AccountSettings";
import { TwoFactorSettings } from "@/components/settings/TwoFactorSettings";
import { countUnusedRecoveryCodes } from "@/lib/auth/recoveryCodes";

export default async function AccountSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [user, storage] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, image: true, username: true, bio: true, createdAt: true, defaultVisibilityMoodboard: true, defaultVisibilityVisit: true, defaultVisibilityCollection: true, twoFactorEnabled: true, twoFactorEnabledAt: true, twoFactorSecret: true },
    }),
    getStorageQuota(session.user.id),
  ]);

  if (!user) redirect("/login");

  return (
    <div className="p-6 max-w-xl">
      <h2 className="text-sm font-medium text-[var(--text-primary)] mb-6">Compte</h2>
      <AccountSettings
        initialName={user.name ?? ""}
        initialEmail={user.email}
        initialImage={user.image}
        initialUsername={user.username ?? ""}
        initialBio={user.bio ?? ""}
        initialDefaults={{
          moodboard: user.defaultVisibilityMoodboard,
          visit: user.defaultVisibilityVisit,
          collection: user.defaultVisibilityCollection,
        }}
        memberSince={user.createdAt.toISOString()}
        storage={{
          usedBytes: storage.usedBytes,
          maxBytes: storage.maxBytes,
          usedPercent: storage.usedPercent,
          isNearLimit: storage.isNearLimit,
          formatted: storage.formatted,
        }}
      />

      {/* Sécurité : second facteur, indépendant du reste du formulaire de compte. */}
      <div className="mt-10 pt-8 border-t border-[var(--border-subtle)]">
        <TwoFactorSettings
          initialStatus={{
            enabled: user.twoFactorEnabled,
            pending: !user.twoFactorEnabled && Boolean(user.twoFactorSecret),
            enabledAt: user.twoFactorEnabledAt?.toISOString() ?? null,
            recoveryCodesLeft: user.twoFactorEnabled
              ? await countUnusedRecoveryCodes(session.user.id)
              : 0,
          }}
        />
      </div>
    </div>
  );
}
