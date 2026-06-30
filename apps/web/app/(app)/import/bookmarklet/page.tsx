"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, Suspense } from "react";
import { Button } from "@/components/ui/Button";

function BookmarkletImport() {
  const params = useSearchParams();
  const router = useRouter();

  const imageUrl = params.get("imageUrl") || "";
  const sourceUrl = params.get("sourceUrl") || "";
  const initialAuthor = params.get("author") || "";
  const initialTitle = params.get("title") || "";

  const [title, setTitle] = useState(initialTitle);
  const [author, setAuthor] = useState(initialAuthor);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [imgError, setImgError] = useState(false);

  const isDirectImageUrl = /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(imageUrl) ||
    imageUrl.includes("cdninstagram.com") ||
    imageUrl.includes("pinimg.com") ||
    imageUrl.includes("fbcdn.net");

  async function save() {
    if (!imageUrl) return;
    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/import/direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, title, author, description, sourceUrl }),
      });

      const data = await res.json() as { inspirationId?: string; error?: string };

      if (!res.ok || !data.inspirationId) {
        throw new Error(data.error ?? "Erreur inconnue");
      }

      router.push(`/library/${data.inspirationId}?fresh=1`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const fieldClass =
    "w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm rounded px-3 py-2 focus:outline-none focus:border-[var(--border-default)] transition-colors placeholder:text-[var(--text-tertiary)]";
  const labelClass = "block text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5";

  if (!imageUrl) {
    return (
      <div className="p-6 text-[var(--text-secondary)] text-sm">
        Aucune image à importer. Utilisez le bookmarklet depuis une page web.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-xl mx-auto">
      <header className="mb-6">
        <p className="text-[var(--text-tertiary)] text-xs tracking-widest uppercase mb-1">Import</p>
        <h1 className="text-2xl font-light text-[var(--text-primary)]">Sauvegarder l&apos;image</h1>
        {sourceUrl && (
          <p className="text-xs text-[var(--text-tertiary)] mt-1 truncate">
            Source : {sourceUrl}
          </p>
        )}
      </header>

      {/* Image preview */}
      <div className="mb-6 rounded-lg overflow-hidden bg-[var(--bg-surface)] border border-[var(--border-subtle)] aspect-video flex items-center justify-center">
        {imgError ? (
          <p className="text-xs text-[var(--text-tertiary)] px-4 text-center">
            Aperçu indisponible — l&apos;image sera téléchargée lors de la sauvegarde.
          </p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Aperçu"
            className="max-h-64 max-w-full object-contain"
            onError={() => setImgError(true)}
            referrerPolicy="no-referrer"
          />
        )}
      </div>

      {!isDirectImageUrl && (
        <div className="mb-4 p-3 rounded bg-amber-950/30 border border-amber-800/40 text-amber-400 text-xs">
          Cette URL ne semble pas pointer directement vers une image. La sauvegarde pourrait échouer.
        </div>
      )}

      {/* Metadata form */}
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Titre</label>
          <input
            type="text"
            className={fieldClass}
            placeholder="Titre de l&apos;image"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Auteur / Artiste</label>
          <input
            type="text"
            className={fieldClass}
            placeholder="Nom de l&apos;auteur"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea
            className={fieldClass}
            rows={2}
            placeholder="Description optionnelle"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p className="mt-4 text-xs text-red-400 bg-red-950/30 border border-red-800/40 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <Button onClick={save} disabled={saving || !imageUrl} className="flex-1">
          {saving ? "Sauvegarde…" : "Sauvegarder dans la bibliothèque"}
        </Button>
        <button
          onClick={() => router.back()}
          className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

export default function BookmarkletPage() {
  return (
    <Suspense>
      <BookmarkletImport />
    </Suspense>
  );
}
