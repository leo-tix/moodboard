'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

type State = 'hidden' | 'android' | 'android-manual' | 'ios';

export function PwaInstallButton() {
  const [state, setState] = useState<State>('hidden');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [prompt, setPrompt] = useState<any>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Already installed as PWA
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if ((window.navigator as { standalone?: boolean }).standalone === true) return;

    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isAndroid = /android/i.test(ua);
    if (!isIos && !isAndroid) return; // desktop: skip

    if (isIos) { setState('ios'); return; }

    // Android: always show button — doesn't require beforeinstallprompt
    setState('android-manual'); // fallback by default

    // Use early-captured prompt from layout.tsx inline script
    const early = (window as { __pwaPrompt?: Event }).__pwaPrompt;
    if (early) { setPrompt(early); setState('android'); }

    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e); setState('android'); };
    const onInstalled = () => setState('hidden');
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (state === 'hidden') return null;

  const btnClass = 'flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] rounded-md hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors';

  // Android — native prompt available
  if (state === 'android') {
    return (
      <button
        className={btnClass}
        onClick={async () => {
          if (!prompt) return;
          prompt.prompt();
          const { outcome } = await prompt.userChoice;
          if (outcome === 'accepted') setState('hidden');
          setPrompt(null);
        }}
      >
        <DownloadIcon />
        Installer l&apos;app
      </button>
    );
  }

  // Android — no prompt, show manual instructions
  if (state === 'android-manual') {
    return (
      <div className="relative flex-shrink-0">
        <button className={btnClass} onClick={() => setOpen((v) => !v)}>
          <DownloadIcon />
          Installer l&apos;app
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-2 z-50 w-60 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] p-3 text-xs text-[var(--text-secondary)] shadow-xl">
            <p className="mb-1 font-medium text-[var(--text-primary)]">Installer sur Android</p>
            <p>Dans Chrome, appuyez sur <span className="font-medium">⋮</span> puis <span className="font-medium">« Ajouter à l&apos;écran d&apos;accueil »</span>.</p>
            <button onClick={() => setOpen(false)} className="mt-2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">Fermer</button>
          </div>
        )}
      </div>
    );
  }

  // iOS
  return (
    <div className="relative flex-shrink-0">
      <button className={btnClass} onClick={() => setOpen((v) => !v)}>
        <DownloadIcon />
        Installer l&apos;app
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-60 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] p-3 text-xs text-[var(--text-secondary)] shadow-xl">
          <p className="mb-1 font-medium text-[var(--text-primary)]">Installer sur iPhone</p>
          <p>Dans Safari, appuyez sur <span className="font-medium">⬆</span> puis <span className="font-medium">« Sur l&apos;écran d&apos;accueil »</span>.</p>
          <button onClick={() => setOpen(false)} className="mt-2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">Fermer</button>
        </div>
      )}
    </div>
  );
}

function DownloadIcon() {
  return <Download size={12} strokeWidth={1.75} />;
}
