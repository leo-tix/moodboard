import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { MessagesClient } from "@/components/messaging/MessagesClient";
import { SocialTabs } from "@/components/social/SocialTabs";

export const dynamic = "force-dynamic";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { c } = await searchParams;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <SocialTabs />
      <MessagesClient initialConversationId={c} />
    </div>
  );
}
