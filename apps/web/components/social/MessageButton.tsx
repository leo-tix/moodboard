"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";

// Ouvre (ou crée) la conversation avec un membre et navigue vers la messagerie.
export function MessageButton({ targetUserId }: { targetUserId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: targetUserId }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.conversationId) router.push(`/messages?c=${d.conversationId}`);
    } finally { setBusy(false); }
  };

  return (
    <button
      onClick={open}
      disabled={busy}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-40 transition-colors"
    >
      <MessageCircle size={15} strokeWidth={2} /> Message
    </button>
  );
}
