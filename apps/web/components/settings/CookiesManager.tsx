"use client";

import { useEffect, useState } from "react";
import { Video, Camera, ChevronDown, Trash2, type LucideIcon } from "lucide-react";

type Platform = "youtube" | "instagram";

interface PlatformStatus {
  configured: boolean;
  updatedAt: string | null;
}

type StatusMap = Record<Platform, PlatformStatus>;

// lucide-react n'inclut pas de logos de marques (Youtube/Instagram) — icônes
// génériques à la place, voir memory feedback_icon_library.
const PLATFORM_META: Record<Platform, { label: string; icon: LucideIcon; domain: string }> = {
  youtube: { label: "YouTube", icon: Video, domain: "youtube.com" },
  instagram: { label: "Instagram", icon: Camera, domain: "instagram.com" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

export function CookiesManager() {
  const [status, setStatus] = useState<StatusMap | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/video-link/cookies");
      if (!res.ok) throw new Error();
      setStatus(await res.json());
    } catch {
      setLoadError(true);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      {(Object.keys(PLATFORM_META) as Platform[]).map((platform) => (
        <PlatformCard
          key={platform}
          platform={platform}
          status={status?.[platform] ?? null}
          onChanged={load}
        />
      ))}
      {loadError && (
        <p className="text-[11px] text-red-400">
          Impossible de lire le statut actuel (service de conversion indisponible) — tu peux
          quand même déposer de nouveaux cookies ci-dessus.
        </p>
      )}
    </div>
  );
}

function PlatformCard({
  platform,
  status,
  onChanged,
}: {
  platform: Platform;
  status: PlatformStatus | null;
  onChanged: () => void;
}) {
  const meta = PLATFORM_META[platform];
  const Icon = meta.icon;
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function save() {
    setError("");
    setSuccess(false);
    if (!content.trim()) {
      setError("Colle le contenu du fichier cookies.txt exporté.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/video-link/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Échec de l'enregistrement.");
        return;
      }
      setContent("");
      setSuccess(true);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    setDeleting(true);
    setError("");
    setSuccess(false);
    try {
      const res = await fetch(`/api/admin/video-link/cookies?platform=${platform}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Échec de suppression.");
        return;
      }
      onChanged();
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon size={15} strokeWidth={1.75} className="text-[var(--text-tertiary)]" />
          <span className="text-sm text-[var(--text-primary)]">{meta.label}</span>
        </div>
        {status?.configured ? (
          <span className="text-[11px] text-emerald-400">
            Connecté · {formatDate(status.updatedAt)}
          </span>
        ) : (
          <span className="text-[11px] text-[var(--text-tertiary)]">Non configuré</span>
        )}
      </div>

      <button
        onClick={() => setTutorialOpen((v) => !v)}
        className="mt-3 flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
      >
        <ChevronDown
          size={12}
          strokeWidth={1.75}
          className={`transition-transform ${tutorialOpen ? "rotate-180" : ""}`}
        />
        Comment récupérer le fichier cookies.txt ?
      </button>

      {tutorialOpen && (
        <ol className="mt-2 ml-1 space-y-1.5 text-[11px] text-[var(--text-secondary)] list-decimal list-inside">
          <li>
            Installe l&apos;extension <strong>&quot;Get cookies.txt LOCALLY&quot;</strong> dans
            ton navigateur (open-source, n&apos;envoie rien à un serveur tiers).
          </li>
          <li>
            Connecte-toi sur <strong>{meta.domain}</strong> avec le compte dédié que tu as créé
            (jamais ton compte personnel).
          </li>
          <li>
            Clique sur l&apos;icône de l&apos;extension, choisis le format Netscape puis
            &quot;Export&quot; (ou copie le contenu affiché).
          </li>
          <li>Colle tout le contenu ci-dessous et clique sur &quot;Enregistrer&quot;.</li>
        </ol>
      )}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="# Netscape HTTP Cookie File&#10;..."
        rows={4}
        spellCheck={false}
        className="mt-3 w-full px-2.5 py-2 text-[11px] font-mono rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--border-strong)] resize-y"
      />

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      {success && !error && (
        <p className="mt-2 text-[11px] text-emerald-400">Cookies enregistrés.</p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="text-[11px] px-2.5 py-1 rounded bg-[var(--accent,#a78bfa)] text-black font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        {status?.configured && (
          confirming ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={del}
                disabled={deleting}
                className="text-[11px] px-2 py-1 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-50"
              >
                Confirmer
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-[11px] px-2 py-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              >
                Annuler
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded text-[var(--text-tertiary)] hover:text-red-400 transition-colors"
            >
              <Trash2 size={12} strokeWidth={1.75} /> Retirer
            </button>
          )
        )}
      </div>
    </div>
  );
}
