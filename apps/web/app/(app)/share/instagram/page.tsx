'use client';

import { useRouter } from 'next/navigation';

export default function ShareInstagramPage() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-6">
      <div className="flex flex-col items-center gap-3 text-center max-w-xs">
        <div className="w-12 h-12 rounded-full bg-[var(--bg-surface)] border border-[var(--border-default)] flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="14" height="14" rx="3" />
            <circle cx="10" cy="10" r="3" />
            <circle cx="14.2" cy="5.8" r="0.6" fill="var(--text-secondary)" stroke="none" />
          </svg>
        </div>
        <p className="text-sm font-medium text-[var(--text-primary)]">
          Import automatique indisponible pour Instagram
        </p>
        <p className="text-xs text-[var(--text-tertiary)]">
          Faites une capture d&apos;écran de la publication, puis partagez l&apos;image (et non le lien) vers Moodboard — elle sera importée normalement.
        </p>
        <button
          onClick={() => router.push('/upload')}
          className="mt-2 text-xs text-[var(--text-secondary)] underline hover:text-[var(--text-primary)] transition-colors"
        >
          Retour
        </button>
      </div>
    </div>
  );
}
