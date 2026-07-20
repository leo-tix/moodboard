import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { SocialTabs } from "@/components/social/SocialTabs";
import { NotificationsClient } from "@/components/social/NotificationsClient";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <SocialTabs />
      <NotificationsClient />
    </div>
  );
}
