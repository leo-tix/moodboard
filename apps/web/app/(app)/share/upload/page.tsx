'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const SHARE_DB = 'moodboard-share';

function openShareDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('batches', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadBatch(id: string): Promise<{ files: File[]; title: string } | null> {
  const db = await openShareDb();
  const batch = await new Promise<{ files: File[]; title: string } | null>((resolve, reject) => {
    const tx = db.transaction('batches', 'readonly');
    const req = tx.objectStore('batches').get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return batch;
}

async function deleteBatch(id: string) {
  const db = await openShareDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('batches', 'readwrite');
    tx.objectStore('batches').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export default function ShareUploadPage() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get('id');
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) { router.replace('/upload'); return; }

    let cancelled = false;

    (async () => {
      const batch = await loadBatch(id);
      if (!batch || batch.files.length === 0) {
        if (!cancelled) router.replace('/upload?error=processing');
        return;
      }

      setTotal(batch.files.length);
      let saved = 0;

      for (const file of batch.files) {
        if (cancelled) return;
        try {
          const fd = new FormData();
          fd.set('image', file);
          if (batch.title) fd.set('title', batch.title);
          const res = await fetch('/api/share/upload-one', { method: 'POST', body: fd });
          const json = await res.json().catch(() => ({}));
          if (res.ok && json.ok) saved++;
        } catch {
          // continue with remaining files
        }
        if (!cancelled) setDone((d) => d + 1);
      }

      await deleteBatch(id).catch(() => {});

      if (cancelled) return;

      if (saved === 0) {
        setError(true);
        setTimeout(() => router.replace('/upload?error=processing'), 1500);
      } else {
        router.replace(`/share/done?count=${saved}`);
      }
    })();

    return () => { cancelled = true; };
  }, [id, router]);

  const progress = total > 0 ? (done / total) * 100 : 0;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
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
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {error ? "Échec de l'envoi" : total > 0 ? `Envoi ${done}/${total}…` : 'Préparation…'}
        </p>
        {!error && <p className="text-xs text-[var(--text-tertiary)]">Ne fermez pas cette fenêtre</p>}
      </div>

      <div className="w-48 h-0.5 bg-[var(--bg-surface)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--text-primary)] rounded-full transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
