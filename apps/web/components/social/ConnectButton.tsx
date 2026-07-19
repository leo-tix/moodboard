"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, UserPlus, Clock, X } from "lucide-react";
import type { RelationStatus } from "@/lib/access/connections";

const primary =
  "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-[var(--text-primary)] text-[var(--bg-base)] hover:opacity-90 disabled:opacity-40 transition-opacity";
const ghost =
  "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-40 transition-colors";

// Bouton de connexion à états, piloté par la relation viewer→target.
export function ConnectButton({
  targetUserId,
  initialStatus,
  connectionId,
}: {
  targetUserId: string;
  initialStatus: RelationStatus;
  connectionId?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<RelationStatus>(initialStatus);
  const [connId, setConnId] = useState<string | undefined>(connectionId);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      router.refresh();
    }
  };

  const connect = () =>
    run(async () => {
      const r = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: targetUserId }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setStatus(d.status === "connected" ? "connected" : "outgoing");
        setConnId(d.connectionId);
      }
    });

  const del = (next: RelationStatus) =>
    run(async () => {
      if (!connId) return;
      await fetch(`/api/connections/${connId}`, { method: "DELETE" });
      setStatus(next);
      setConnId(undefined);
    });

  const respond = (action: "accept" | "decline") =>
    run(async () => {
      if (!connId) return;
      await fetch(`/api/connections/${connId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (action === "accept") setStatus("connected");
      else {
        setStatus("none");
        setConnId(undefined);
      }
    });

  if (status === "self") return null;

  if (status === "connected")
    return (
      <button className={ghost} disabled={busy} onClick={() => del("none")}>
        <Check size={15} strokeWidth={2} /> Connecté
      </button>
    );

  if (status === "outgoing")
    return (
      <button className={ghost} disabled={busy} onClick={() => del("none")}>
        <Clock size={15} strokeWidth={2} /> Demande envoyée
      </button>
    );

  if (status === "incoming")
    return (
      <span className="inline-flex items-center gap-2">
        <button className={primary} disabled={busy} onClick={() => respond("accept")}>
          <Check size={15} strokeWidth={2} /> Accepter
        </button>
        <button className={ghost} disabled={busy} onClick={() => respond("decline")}>
          <X size={15} strokeWidth={2} /> Refuser
        </button>
      </span>
    );

  return (
    <button className={primary} disabled={busy} onClick={connect}>
      <UserPlus size={15} strokeWidth={2} /> Se connecter
    </button>
  );
}
