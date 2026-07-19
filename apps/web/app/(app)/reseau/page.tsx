import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { NetworkClient } from "@/components/social/NetworkClient";

export const dynamic = "force-dynamic";

export default async function ReseauPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-sm font-medium text-[var(--text-primary)] mb-6">Réseau</h1>
      <NetworkClient />
    </div>
  );
}
