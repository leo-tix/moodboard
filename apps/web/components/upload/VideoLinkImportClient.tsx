"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { VideoTrimModal } from "@/components/upload/VideoTrimModal";

// Transforme un lien TikTok / Instagram / générique en GIF : la vidéo est
// téléchargée côté serveur (apps/gif-worker, via yt-dlp) puis passée à
// VideoTrimModal EXACTEMENT comme un fichier local déposé dans DropZone —
// ce composant ne fait que produire ce `File`, tout le reste (trim,
// conversion GIF, upload) est le pipeline existant, inchangé.

interface Ticket {
  url: string;
  token: string;
  platform: "tiktok" | "instagram" | "generic";
  sourceLabel: string;
  sourceUrl: string;
  title: string | null;
  isAdmin: boolean;
}

interface PendingImport {
  file: File;
  sourceLabel: string;
  sourceUrl: string;
}

interface ImportResult {
  inspirationId: string;
  thumbnailKey: string | null;
}

const fieldClass =
  "w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[var(--border-default)] transition-colors placeholder:text-[var(--text-tertiary)]";

function extFromContentType(contentType: string | null): string {
  if (!contentType) return "mp4";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("quicktime")) return "mov";
  if (contentType.includes("matroska")) return "mkv";
  return "mp4";
}

export function VideoLinkImportClient() {
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<"idle" | "ticket" | "downloading" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = step !== "idle";
  const isValid = /^https?:\/\//i.test(url.trim());

  const handleImport = async () => {
    const trimmed = url.trim();
    if (!trimmed || !isValid) return;
    setError(null);
    setDetail(null);
    setResult(null);

    try {
      setStep("ticket");
      const ticketRes = await fetch("/api/video-link/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const ticket = (await ticketRes.json()) as Partial<Ticket> & { error?: string; detail?: string };
      if (!ticketRes.ok || !ticket.url || !ticket.token) {
        setError(ticket.error || "Import impossible.");
        setDetail(ticket.detail ?? null);
        return;
      }

      setStep("downloading");
      const videoRes = await fetch(ticket.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${ticket.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      if (!videoRes.ok) {
        const body = (await videoRes.json().catch(() => ({}))) as { error?: string; message?: string };
        setError("Téléchargement de la vidéo échoué (lien privé, géo-bloqué, ou refusé par la plateforme).");
        setDetail(ticket.isAdmin ? body.message || body.error || null : null);
        return;
      }

      const blob = await videoRes.blob();
      const ext = extFromContentType(videoRes.headers.get("content-type"));
      const file = new File([blob], `video.${ext}`, { type: blob.type || "video/mp4" });
      setPending({ file, sourceLabel: ticket.sourceLabel!, sourceUrl: ticket.sourceUrl! });
      setUrl("");
    } catch {
      setError("Erreur réseau — vérifie ta connexion.");
    } finally {
      setStep("idle");
    }
  };

  const handleConverted = async (gifFile: File, meta: PendingImport) => {
    setPending(null);
    setStep("uploading");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", gifFile);
      fd.append("source", meta.sourceLabel);
      fd.append("sourceUrl", meta.sourceUrl);
      const res = await fetch("/api/upload/image", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as {
        inspirationId?: string;
        image?: { thumbnailKey?: string };
        error?: string;
      };
      if (!res.ok || !data.inspirationId) {
        setError(data.error || "Échec de l'import.");
        return;
      }
      setResult({ inspirationId: data.inspirationId, thumbnailKey: data.image?.thumbnailKey ?? null });
    } catch {
      setError("Erreur réseau pendant l'import.");
    } finally {
      setStep("idle");
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setDetail(null);
    setUrl("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const stepLabel =
    step === "ticket" ? "Vérification…" : step === "downloading" ? "Téléchargement de la vidéo…" : step === "uploading" ? "Import…" : null;

  return (
    <div className="space-y-6 max-w-lg">
      <div className="space-y-1.5">
        <p className="text-xs text-[var(--text-tertiary)]">
          Colle le lien d&apos;une vidéo TikTok, Instagram, ou une autre source — la vidéo est téléchargée côté
          serveur puis tu choisis le passage à convertir en GIF.
        </p>
        <div className="flex flex-wrap gap-2 text-[10px] text-[var(--text-tertiary)]">
          <span className="px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            tiktok.com/…
          </span>
          <span className="px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            instagram.com/reel/…
          </span>
          <span className="px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            autre lien vidéo direct
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setError(null); setDetail(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleImport(); }}
          placeholder="https://www.tiktok.com/@…/video/…"
          className={`${fieldClass} flex-1`}
          disabled={busy}
          autoFocus
        />
        <button
          onClick={handleImport}
          disabled={busy || !isValid}
          className="px-4 py-2.5 bg-[var(--text-primary)] text-[var(--bg-base)] text-sm rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center gap-2 flex-shrink-0"
        >
          {busy ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-base)] border-t-transparent animate-spin" />
              {stepLabel}
            </>
          ) : (
            "Importer"
          )}
        </button>
      </div>

      {url && !isValid && (
        <p className="text-[10px] text-red-400 -mt-3">Colle un lien complet, commençant par http(s)://</p>
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <span className="text-red-400 flex-shrink-0 flex"><X size={16} strokeWidth={2} /></span>
          <div>
            <p className="text-sm text-red-400 font-medium">Import échoué</p>
            <p className="text-xs text-red-300/80 mt-0.5">{error}</p>
            {detail && <p className="text-[10px] text-red-300/50 mt-1.5 font-mono">{detail}</p>}
          </div>
        </div>
      )}

      {result && (
        <div className="flex items-start gap-4 p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
          {result.thumbnailKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={getThumbnailUrl(result.thumbnailKey)}
              alt=""
              className="w-16 h-16 rounded-lg object-cover flex-shrink-0 bg-[var(--bg-elevated)]"
            />
          )}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-green-400 flex"><Check size={14} strokeWidth={2} /></span>
              <p className="text-xs font-medium text-[var(--text-primary)]">GIF importé</p>
            </div>
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

      {pending && (
        <VideoTrimModal
          file={pending.file}
          onCancel={() => setPending(null)}
          onConverted={(gifFile) => handleConverted(gifFile, pending)}
        />
      )}
    </div>
  );
}
