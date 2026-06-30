'use client';

import { useEffect, useState } from 'react';

type State = 'hidden' | 'android' | 'ios';

export function PwaInstallButton() {
  const [state, setState] = useState<State>('hidden');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [prompt, setPrompt] = useState<any>(null);
  const [iosOpen, setIosOpen] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if ((window.navigator as { standalone?: boolean }).standalone === true) return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) { setState('ios'); return; }

    // Event may have fired before React hydrated — layout.tsx captures it early
    const early = (window as { __pwaPrompt?: Event }).__pwaPrompt;
    if (early) { setPrompt(early); setState('android'); return; }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
      setState('android');
    };
    const onInstalled = () => setState('hidden');

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (state === 'hidden') return null;

  if (state === 'ios') {
    return (
      <div className="relative flex-shrink-0">
        <button
          onClick={() => setIosOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] rounded-md hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors"
        >
          <DownloadIcon />
          Installer
        </button>
        {iosOpen && (
          <div className="absolute right-0 top-full mt-2 z-50 w-56 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] p-3 text-xs text-[var(--text-secondary)] shadow-xl">
            <p className="mb-1 font-medium text-[var(--text-primary)]">Ajouter à l&apos;écran d&apos;accueil</p>
            <p>Dans Safari, appuyez sur <span className="font-medium">⬆</span> puis <span className="font-medium">« Sur l&apos;écran d&apos;accueil »</span>.</p>
            <button
              onClick={() => setIosOpen(false)}
              className="mt-2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
            >
              Fermer
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={async () => {
        if (!prompt) return;
        prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') setState('hidden');
        setPrompt(null);
      }}
      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] rounded-md hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors"
    >
      <DownloadIcon />
      Installer l&apos;app
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 1v7M3.5 5.5 6 8l2.5-2.5" />
      <path d="M1.5 10.5h9" />
    </svg>
  );
}
