"use client";

import { useState, useEffect, useRef } from "react";
import { Check } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function ExtensionsSection() {
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

  return (
    <div className="space-y-8">

      {/* Extension Chrome — téléchargement + installation */}
      <section>
        <h3 className="text-xs font-medium text-[var(--text-primary)] mb-1">
          Extension Chrome
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mb-4 leading-relaxed">
          Survolez n&apos;importe quelle image sur le web (Instagram, Pinterest, sites…) et
          cliquez pour la sauvegarder directement dans votre bibliothèque — carousels compris.
        </p>

        <a
          href="/moodboard-extension.zip"
          download
          className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-[#0a0a0a] text-sm font-medium rounded hover:opacity-90 transition-opacity"
        >
          ⬇ Télécharger l&apos;extension (.zip)
        </a>

        <div className="mt-4 p-3 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-2">Installation</p>
          <ol className="text-xs text-[var(--text-secondary)] space-y-1 list-decimal list-inside">
            <li>Décompressez le fichier téléchargé</li>
            <li>Ouvrez <code className="text-[var(--text-primary)]">chrome://extensions</code></li>
            <li>Activez le <strong>mode développeur</strong> (en haut à droite)</li>
            <li>Cliquez <strong>&quot;Charger l&apos;extension non empaquetée&quot;</strong> et sélectionnez le dossier décompressé</li>
            <li>Collez votre token d&apos;API ci-dessous dans le popup de l&apos;extension</li>
          </ol>
        </div>

        <div className="mt-4">
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-2">
            Token d&apos;API
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
                  {tokenCopied ? <span className="inline-flex items-center gap-1"><Check size={12} strokeWidth={2} /> Copié</span> : "Copier"}
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
            <span className="inline-flex items-center gap-1.5"><Check size={13} strokeWidth={2} /> Application déjà installée</span>
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
