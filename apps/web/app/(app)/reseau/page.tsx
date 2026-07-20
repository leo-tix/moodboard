import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { NetworkClient } from "@/components/social/NetworkClient";
import { SocialTabs } from "@/components/social/SocialTabs";

export const dynamic = "force-dynamic";

export default async function ReseauPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <SocialTabs />
      <NetworkClient />
    </div>
  );
}
