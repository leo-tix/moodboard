'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X, Loader2 } from 'lucide-react';

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
            <X size={20} strokeWidth={1.75} className="text-[#f87171]" />
          ) : (
            <Loader2 size={20} strokeWidth={1.75} className="text-[var(--text-primary)] animate-spin" />
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
