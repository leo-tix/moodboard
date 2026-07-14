'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check } from 'lucide-react';

export default function ShareDonePage() {
  const router = useRouter();
  const params = useSearchParams();
  const count = Number(params.get('count') ?? 1);
  const [progress, setProgress] = useState(0);
  const raf = useRef<number>(null);
  const start = useRef<number | null>(null);
  const DURATION = 1800; // ms before redirect

  useEffect(() => {
    const animate = (ts: number) => {
      if (start.current === null) start.current = ts;
      const elapsed = ts - start.current;
      const pct = Math.min((elapsed / DURATION) * 100, 100);
      setProgress(pct);
      if (pct < 100) {
        raf.current = requestAnimationFrame(animate);
      } else {
        router.replace('/triage');
      }
    };
    raf.current = requestAnimationFrame(animate);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--bg-surface)] border border-[var(--border-default)] flex items-center justify-center">
          <Check size={20} strokeWidth={1.75} className="text-[var(--text-primary)]" />
        </div>
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {count === 1 ? '1 image ajoutée' : `${count} images ajoutées`}
        </p>
        <p className="text-xs text-[var(--text-tertiary)]">Redirection vers le triage…</p>
      </div>

      <div className="w-48 h-0.5 bg-[var(--bg-surface)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--text-primary)] rounded-full transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
