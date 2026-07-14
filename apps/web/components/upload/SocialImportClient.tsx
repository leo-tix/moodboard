"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Check, X, AlertTriangle } from "lucide-react";
import { getThumbnailUrl } from "@/lib/storage/urls";

interface ImportResult {
  inspirationId: string;
  title: string;
  author: string;
  source: string;
  image: { storageKey: string; thumbnailKey: string };
}

const fieldClass =
  "w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[var(--border-default)] transition-colors placeholder:text-[var(--text-tertiary)]";

export function SocialImportClient() {
  const [url, setUrl]           = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [result, setResult]     = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isPinterest = /pinterest\.[a-z.]+|pin\.it/i.test(url);
  const isInstagram = url.includes("instagram.com");
  const isValid     = isPinterest || isInstagram;

  const handleImport = async () => {
    if (!url.trim() || !isValid) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/import/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erreur inconnue");
      } else {
        setResult(data as ImportResult);
        setUrl("");
      }
    } catch {
      setError("Erreur réseau — vérifiez votre connexion");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleImport();
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setUrl("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div className="space-y-6 max-w-lg">

      {/* Instructions */}
      <div className="space-y-1.5">
        <p className="text-xs text-[var(--text-tertiary)]">
          Colle le lien d&apos;une épingle Pinterest ou d&apos;une publication Instagram.
        </p>
        <div className="flex flex-wrap gap-2 text-[10px] text-[var(--text-tertiary)]">
          <span className="px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            pinterest.com/pin/…
          </span>
          <span className="px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            instagram.com/p/…
          </span>
        </div>
      </div>

      {/* Input + bouton */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setError(null); }}
          onKeyDown={handleKeyDown}
          placeholder="https://www.pinterest.com/pin/…"
          className={`${fieldClass} flex-1`}
          disabled={loading}
          autoFocus
        />
        <button
          onClick={handleImport}
          disabled={loading || !isValid}
          className="px-4 py-2.5 bg-[var(--text-primary)] text-[var(--bg-base)] text-sm rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center gap-2 flex-shrink-0"
        >
          {loading ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-base)] border-t-transparent animate-spin" />
              Import…
            </>
          ) : (
            "Importer"
          )}
        </button>
      </div>

      {/* Indicateur réseau */}
      {url && isValid && !loading && (
        <p className="text-[10px] text-[var(--text-tertiary)] -mt-3 inline-flex items-center gap-1">
          {isPinterest ? <><Check size={11} strokeWidth={2} /> Lien Pinterest détecté</> : <><AlertTriangle size={11} strokeWidth={2} /> Lien Instagram détecté — peut échouer si la publication est protégée</>}
        </p>
      )}
      {url && !isValid && url.startsWith("http") && (
        <p className="text-[10px] text-red-400 -mt-3">
          URL non reconnue. Acceptés : pinterest.com/pin/… ou instagram.com/p/…
        </p>
      )}

      {/* Erreur */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <span className="text-red-400 flex-shrink-0 flex"><X size={16} strokeWidth={2} /></span>
          <div>
            <p className="text-sm text-red-400 font-medium">Import échoué</p>
            <p className="text-xs text-red-300/80 mt-0.5">{error}</p>
            {isInstagram && (
              <p className="text-[10px] text-red-300/60 mt-1.5">
                Instagram bloque souvent les accès automatiques. Essayez avec une image directe (clic droit → Copier l&apos;adresse de l&apos;image).
              </p>
            )}
          </div>
        </div>
      )}

      {/* Succès */}
      {result && (
        <div className="flex items-start gap-4 p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
          {result.image.thumbnailKey && (
            <img
              src={getThumbnailUrl(result.image.thumbnailKey)}
              alt={result.title}
              className="w-16 h-16 rounded-lg object-cover flex-shrink-0 bg-[var(--bg-elevated)]"
            />
          )}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-green-400 flex"><Check size={14} strokeWidth={2} /></span>
              <p className="text-xs font-medium text-[var(--text-primary)] truncate">{result.title}</p>
            </div>
            {result.author && (
              <p className="text-[10px] text-[var(--text-tertiary)]">{result.author}</p>
            )}
            <p className="text-[10px] text-[var(--text-tertiary)]">Source : {result.source}</p>
            <div className="flex gap-3 pt-1">
              <Link
                href={`/library/${result.inspirationId}`}
                className="text-[10px] text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity"
              >
                Voir dans la bibliothèque →
              </Link>
              <button
                onClick={reset}
                className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
              >
                Importer un autre lien
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
