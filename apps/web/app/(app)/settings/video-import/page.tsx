import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/current";
import { CookiesManager } from "@/components/settings/CookiesManager";

export const dynamic = "force-dynamic";

export default async function VideoImportPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/settings/account");

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-sm font-medium text-[var(--text-primary)] mb-1">Import vidéo</h2>
      <p className="text-xs text-[var(--text-tertiary)] mb-6">
        Instagram et YouTube bloquent de plus en plus les téléchargements anonymes depuis
        le serveur. Connecte un compte dédié dans ton navigateur et dépose ses cookies ici
        pour que l&apos;import de GIF depuis un lien continue de fonctionner.
      </p>
      <CookiesManager />
    </div>
  );
}
