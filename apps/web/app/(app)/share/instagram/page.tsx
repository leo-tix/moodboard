'use client';

import { useRouter } from 'next/navigation';
import { Share2 } from 'lucide-react';

export default function ShareInstagramPage() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-6">
      <div className="flex flex-col items-center gap-3 text-center max-w-xs">
        <div className="w-12 h-12 rounded-full bg-[var(--bg-surface)] border border-[var(--border-default)] flex items-center justify-center">
          <Share2 size={20} strokeWidth={1.75} className="text-[var(--text-secondary)]" />
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
