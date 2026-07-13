"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  visitId: string;
  shareToken: string | null;
  shareExpiry: string | null;
}

// Bouton "Partager" + popover sur la page de détail d'une visite (Phase 5).
// Génère/révoque un lien public vers /carnet/[token], même API et mêmes options
// d'expiration que le partage des planches (SharePanel).
export function VisitShareButton({ visitId, shareToken: initialToken, shareExpiry: initialExpiry }: Props) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(initialToken);
  const [expiry, setExpiry] = useState(initialExpiry);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const isExpired = expiry ? new Date(expiry) < new Date() : false;
  const isActive = !!token && !isExpired;
  const shareUrl = token && typeof window !== "undefined" ? `${window.location.origin}/carnet/${token}` : null;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popoverRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activate = async (opt: "7d" | "30d" | "never") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/visits/${visitId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiry: opt }),
      });
      const data = await res.json();
      setToken(data.shareToken);
      setExpiry(data.shareExpiry ?? null);
    } finally {
      setLoading(false);
    }
  };

  const revoke = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/visits/${visitId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiry: null }),
      });
      const data = await res.json();
      setToken(data.shareToken);
      setExpiry(data.shareExpiry ?? null);
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
    <div className="relative flex-shrink-0">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs bg-[var(--bg-elevated)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        title="Partager le carnet"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
        Partager
        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-2xl p-4 space-y-3"
        >
          <p className="text-xs font-medium text-[var(--text-secondary)]">Carnet public</p>

          {isActive ? (
            <>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                <p className="text-xs text-[var(--text-primary)]">Lien actif</p>
              </div>
              {expiry && (
                <p className="text-[10px] text-[var(--text-tertiary)]">
                  Expire le {new Date(expiry).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              )}
              <div className="flex gap-1.5">
                <input
                  readOnly
                  value={shareUrl ?? ""}
                  className="flex-1 min-w-0 text-[10px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-[var(--text-tertiary)] outline-none"
                />
                <button
                  onClick={copy}
                  className="flex-shrink-0 px-2.5 py-1.5 text-[10px] bg-[var(--bg-base)] border border-[var(--border-default)] rounded text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
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
                Génère un lien public pour partager ce carnet en lecture seule, sans connexion requise.
              </p>
              <div className="space-y-1.5">
                {(["7d", "30d", "never"] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => activate(opt)}
                    disabled={loading}
                    className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-base)] hover:bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded transition-colors disabled:opacity-50"
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
      )}
    </div>
  );
}
