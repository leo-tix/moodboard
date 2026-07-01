'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ShareSocialPage() {
  const router = useRouter();
  const params = useSearchParams();
  const url = params.get('url') || '';
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) { router.replace('/upload'); return; }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/import/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok || !data.inspirationId) {
          setError(data.error || 'Import échoué');
          return;
        }

        router.replace('/share/done?count=1');
      } catch {
        if (!cancelled) setError('Erreur réseau — vérifiez votre connexion');
      }
    })();

    return () => { cancelled = true; };
  }, [url, router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-6">
      <div className="flex flex-col items-center gap-3 text-center max-w-xs">
        <div className="w-12 h-12 rounded-full bg-[var(--bg-surface)] border border-[var(--border-default)] flex items-center justify-center">
          {error ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 6l8 8M14 6l-8 8" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
              <path d="M10 3a7 7 0 1 1-7 7" />
            </svg>
          )}
        </div>
        {error ? (
          <>
            <p className="text-sm font-medium text-[var(--text-primary)]">Import échoué</p>
            <p className="text-xs text-[var(--text-tertiary)]">{error}</p>
            <button
              onClick={() => router.push('/upload')}
              className="mt-2 text-xs text-[var(--text-secondary)] underline hover:text-[var(--text-primary)] transition-colors"
            >
              Retour
            </button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-[var(--text-primary)]">Récupération de la publication…</p>
            <p className="text-xs text-[var(--text-tertiary)]">Ne fermez pas cette fenêtre</p>
          </>
        )}
      </div>
    </div>
  );
}
