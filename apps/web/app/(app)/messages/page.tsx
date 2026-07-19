import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { MessagesClient } from "@/components/messaging/MessagesClient";

export const dynamic = "force-dynamic";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { c } = await searchParams;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-sm font-medium text-[var(--text-primary)] mb-4">Messagerie</h1>
      <MessagesClient initialConversationId={c} />
    </div>
  );
}
