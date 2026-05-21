"use client";

import { useState } from "react";

interface Props {
  moodboardId: string;
  shareToken: string | null;
  shareExpiry: string | null;
  onUpdate: (token: string | null, expiry: string | null) => void;
}

export function SharePanel({ moodboardId, shareToken, shareExpiry, onUpdate }: Props) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = shareToken ? `${window.location.origin}/share/${shareToken}` : null;

  const isExpired = shareExpiry ? new Date(shareExpiry) < new Date() : false;
  const isActive = !!shareToken && !isExpired;

  const activate = async (expiry: "7d" | "30d" | "never") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/moodboards/${moodboardId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiry }),
      });
      const data = await res.json();
      onUpdate(data.shareToken, data.shareExpiry ?? null);
    } finally {
      setLoading(false);
    }
  };

  const revoke = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/moodboards/${moodboardId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiry: null }),
      });
      const data = await res.json();
      onUpdate(data.shareToken, data.shareExpiry ?? null);
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 space-y-4">
      <p className="text-xs font-medium text-[var(--text-secondary)]">Partage public</p>

      {isActive ? (
        <>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
              <p className="text-xs text-[var(--text-primary)]">Lien actif</p>
            </div>
            {shareExpiry && (
              <p className="text-[10px] text-[var(--text-tertiary)]">
                Expire le {new Date(shareExpiry).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            )}
          </div>

          <div className="flex gap-1.5">
            <input
              readOnly
              value={shareUrl ?? ""}
              className="flex-1 min-w-0 text-[10px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-[var(--text-tertiary)] outline-none"
            />
            <button
              onClick={copy}
              className="flex-shrink-0 px-2.5 py-1.5 text-[10px] bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
            >
              {copied ? "✓" : "Copier"}
            </button>
          </div>

          <button
            onClick={revoke}
            disabled={loading}
            className="w-full text-xs text-red-400 hover:text-red-300 transition-colors py-1 disabled:opacity-50"
          >
            Révoquer le lien
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-[var(--text-tertiary)]">
            Génère un lien public pour partager cette planche sans connexion requise.
          </p>
          <div className="space-y-1.5">
            {(["7d", "30d", "never"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => activate(opt)}
                disabled={loading}
                className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded transition-colors disabled:opacity-50"
              >
                {opt === "7d" && "Valable 7 jours"}
                {opt === "30d" && "Valable 30 jours"}
                {opt === "never" && "Sans expiration"}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
