"use client";

import { useState, useEffect, useRef } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface Props {
  bookmarkletCode: string;
}

export function BookmarkletSection({ bookmarkletCode }: Props) {
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [generatingToken, setGeneratingToken] = useState(false);

  async function generateToken() {
    setGeneratingToken(true);
    try {
      const res = await fetch("/api/user/token", { method: "POST" });
      const data = await res.json() as { token?: string };
      if (data.token) setToken(data.token);
    } finally {
      setGeneratingToken(false);
    }
  }

  async function revokeToken() {
    await fetch("/api/user/token", { method: "DELETE" });
    setToken(null);
  }

  function copyToken() {
    if (!token) return;
    navigator.clipboard.writeText(token).then(() => {
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    });
  }
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      promptRef.current = e as BeforeInstallPromptEvent;
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Already installed as PWA
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function installPWA() {
    const prompt = promptRef.current;
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      setInstalled(true);
      setInstallPrompt(null);
    }
  }

  function copyCode() {
    navigator.clipboard.writeText(bookmarkletCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-8">

      {/* Extension Chrome — Token */}
      <section>
        <h3 className="text-xs font-medium text-[var(--text-primary)] mb-1">
          Extension Chrome — Token d&apos;API
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mb-4 leading-relaxed">
          Générez un token et collez-le dans le popup de l&apos;extension pour enregistrer
          des images sans ouvrir de fenêtre supplémentaire.
        </p>

        {token ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[10px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-2 text-[var(--text-secondary)] truncate font-mono">
                {token}
              </code>
              <button
                onClick={copyToken}
                className="shrink-0 px-3 py-2 text-xs bg-[var(--accent)] text-[#0a0a0a] font-medium rounded hover:opacity-90 transition-opacity"
              >
                {tokenCopied ? "✓ Copié" : "Copier"}
              </button>
            </div>
            <p className="text-[10px] text-[var(--text-tertiary)]">
              Ce token ne s&apos;affiche qu&apos;une fois. Copiez-le maintenant dans le popup de l&apos;extension.
            </p>
            <button
              onClick={revokeToken}
              className="text-[10px] text-[var(--text-tertiary)] hover:text-red-400 transition-colors"
            >
              Révoquer le token
            </button>
          </div>
        ) : (
          <button
            onClick={generateToken}
            disabled={generatingToken}
            className="px-4 py-2 text-xs bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] rounded hover:border-[var(--border-strong)] transition-colors disabled:opacity-50"
          >
            {generatingToken ? "Génération…" : "Générer un token"}
          </button>
        )}
      </section>

      {/* Bookmarklet */}
      <section>
        <h3 className="text-xs font-medium text-[var(--text-primary)] mb-1">
          Bookmarklet — Bureau (Chrome, Firefox, Safari)
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mb-4 leading-relaxed">
          Glissez le bouton ci-dessous dans votre barre de favoris. Sur n&apos;importe quelle page
          (Instagram, Pinterest, site web…), cliquez-le pour sauvegarder l&apos;image principale
          dans votre bibliothèque.
        </p>

        <div className="flex items-center gap-3 mb-3">
          {/* Drag-and-drop bookmarklet link */}
          <a
            href={bookmarkletCode}
            draggable
            onClick={(e) => {
              e.preventDefault();
              alert(
                "Glissez ce bouton dans votre barre de favoris (ne cliquez pas dessus ici)."
              );
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-[#0a0a0a] text-sm font-medium rounded cursor-grab active:cursor-grabbing select-none whitespace-nowrap"
          >
            + Sauvegarder sur Moodboard
          </a>
          <span className="text-xs text-[var(--text-tertiary)]">← glissez dans la barre de favoris</span>
        </div>

        <div className="mt-3">
          <p className="text-[10px] text-[var(--text-tertiary)] mb-2 uppercase tracking-widest">
            Ou copiez le code manuellement
          </p>
          <div className="relative">
            <pre className="text-[10px] text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
              {bookmarkletCode.slice(0, 120)}…
            </pre>
            <button
              onClick={copyCode}
              className="absolute top-2 right-2 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] bg-[var(--bg-elevated)] px-2 py-1 rounded transition-colors"
            >
              {copied ? "✓ Copié" : "Copier"}
            </button>
          </div>
        </div>

        <div className="mt-4 p-3 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-2">Comment utiliser</p>
          <ol className="text-xs text-[var(--text-secondary)] space-y-1 list-decimal list-inside">
            <li>Glissez le bouton dans la barre de favoris de votre navigateur</li>
            <li>Naviguez sur un post Instagram, Pinterest ou n&apos;importe quel site</li>
            <li>Cliquez sur le favori — Moodboard s&apos;ouvre avec l&apos;image</li>
            <li>Ajoutez un titre et sauvegardez</li>
          </ol>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-2">
            Sur Instagram : cliquez depuis la page du post (instagram.com/p/…), pas depuis le fil d&apos;actualité.
          </p>
        </div>
      </section>

      {/* PWA / Mobile */}
      <section>
        <h3 className="text-xs font-medium text-[var(--text-primary)] mb-1">
          Application mobile — Android &amp; iOS
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mb-4 leading-relaxed">
          Installez Moodboard comme application sur votre téléphone pour recevoir des images
          directement depuis le menu &quot;Partager&quot; d&apos;Instagram, Pinterest ou de votre galerie photo.
        </p>

        {/* Install button — shown when Chrome fires beforeinstallprompt */}
        {installed ? (
          <div className="mb-4 p-3 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
            ✓ Application déjà installée
          </div>
        ) : installPrompt ? (
          <button
            onClick={installPWA}
            className="mb-4 w-full py-2.5 rounded bg-[var(--accent)] text-[#0a0a0a] text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Installer Moodboard sur cet appareil
          </button>
        ) : (
          <div className="mb-4 p-3 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] leading-relaxed">
            <strong className="text-[var(--text-primary)]">Android :</strong> ouvrez cette page dans Chrome, puis menu <strong>⋮ → Installer l&apos;application</strong> (ou attendez le bandeau automatique).
            <br />
            <strong className="text-[var(--text-primary)] mt-1 block">iOS :</strong> ouvrez dans Safari → bouton Partager ↑ → <strong>Sur l&apos;écran d&apos;accueil</strong>.
          </div>
        )}

        <div className="space-y-3">
          <div className="p-3 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-2">Android (Chrome)</p>
            <ol className="text-xs text-[var(--text-secondary)] space-y-1 list-decimal list-inside">
              <li>Ouvrez Moodboard dans Chrome</li>
              <li>Menu ⋮ → <strong>&quot;Installer l&apos;application&quot;</strong> (pas &quot;Ajouter à l&apos;écran d&apos;accueil&quot;)</li>
              <li>Sur Instagram : maintenez l&apos;image → Partager → Moodboard</li>
            </ol>
          </div>

          <div className="p-3 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-2">iOS (Safari)</p>
            <ol className="text-xs text-[var(--text-secondary)] space-y-1 list-decimal list-inside">
              <li>Ouvrez Moodboard dans Safari</li>
              <li>Bouton Partager → &quot;Sur l&apos;écran d&apos;accueil&quot;</li>
              <li>Sur Instagram : maintenez l&apos;image → Partager → Moodboard</li>
            </ol>
          </div>

          <p className="text-[10px] text-[var(--text-tertiary)]">
            Note : le partage d&apos;image directe (appui long → partager) envoie le fichier image,
            pas l&apos;URL du post. Cela fonctionne pour tout contenu public ou privé visible sur votre écran.
          </p>
        </div>
      </section>
    </div>
  );
}
