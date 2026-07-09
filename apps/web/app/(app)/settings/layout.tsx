import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Desktop : sidebar verticale ; Mobile : onglets horizontaux scrollables */}
      <aside className="md:w-48 flex-shrink-0 md:border-r border-b md:border-b-0 border-[var(--border-subtle)] md:py-6 md:px-3">
        <p className="hidden md:block px-3 text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-3">
          Réglages
        </p>
        <SettingsNav isAdmin={user.role === "ADMIN"} />
      </aside>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
