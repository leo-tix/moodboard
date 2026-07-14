"use client";

import { useEffect, useState } from "react";
import { FileAudio, Trash2 } from "lucide-react";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function fmt(bytes: number): string {
  if (bytes <= 0) return "0 Mo";
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} Go`;
  return `${(bytes / MB).toFixed(1)} Mo`;
}

type Status = "loading" | "idle" | "error";

// Réconciliation de stockage — objets R2 audio (visit-audio/*) qui n'ont plus
// aucune ligne VisitAudio pour les référencer (upload réussi mais création en
// base échouée, voir lib/storage/orphanAudio.ts). Ne concerne QUE le stockage
// R2 : par construction ces objets n'ont pas de ligne à effacer en base.
export function OrphanedFilesPanel() {
  const [status, setStatus] = useState<Status>("loading");
  const [count, setCount] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [result, setResult] = useState<{ deleted: number; freedBytes: number } | null>(null);

  const load = async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/admin/storage/orphan-audio");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCount(data.count);
      setTotalBytes(data.totalBytes);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const cleanup = async () => {
    setCleaning(true);
    try {
      const res = await fetch("/api/admin/storage/orphan-audio", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setResult({ deleted: data.deleted, freedBytes: data.freedBytes });
        setCount(0);
        setTotalBytes(0);
      }
    } finally {
      setCleaning(false);
      setConfirming(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-center gap-2 mb-1">
        <FileAudio size={14} strokeWidth={1.75} className="text-[var(--text-tertiary)]" />
        <span className="text-xs text-[var(--text-secondary)]">Fichiers audio orphelins</span>
      </div>
      <p className="text-[11px] text-[var(--text-tertiary)] mb-3">
        Clips audio présents sur le stockage R2 mais rattachés à aucune visite (upload interrompu, incident…).
        Ne touche jamais un audio réellement utilisé dans un carnet.
      </p>

      {status === "loading" && <p className="text-xs text-[var(--text-tertiary)]">Analyse du bucket…</p>}
      {status === "error" && <p className="text-xs text-red-400">Impossible de vérifier le stockage.</p>}

      {status === "idle" && (
        <>
          {count === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">
              {result ? `${result.deleted} fichier${result.deleted > 1 ? "s" : ""} nettoyé${result.deleted > 1 ? "s" : ""} (${fmt(result.freedBytes)} libérés).` : "Aucun fichier orphelin."}
            </p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-amber-400">
                {count} fichier{count > 1 ? "s" : ""} orphelin{count > 1 ? "s" : ""} — {fmt(totalBytes)}
              </p>
              {confirming ? (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={cleanup}
                    disabled={cleaning}
                    className="text-[11px] px-2 py-1 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-50"
                  >
                    {cleaning ? "Suppression…" : "Confirmer"}
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    disabled={cleaning}
                    className="text-[11px] px-2 py-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(true)}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded text-[var(--text-tertiary)] hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <Trash2 size={12} strokeWidth={1.75} /> Nettoyer
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
