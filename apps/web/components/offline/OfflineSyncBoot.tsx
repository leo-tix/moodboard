"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CloudOff, TriangleAlert } from "lucide-react";
import { ensureAutoFlush } from "@/lib/offline/outbox";
import { ensureAutoSyncVisits, VISITS_SYNCED_EVENT } from "@/lib/offline/syncVisits";
import { listLocalVisits, LOCAL_VISITS_EVENT } from "@/lib/offline/localVisits";

/**
 * Amorce hors ligne de TOUTE l'application.
 *
 * Les deux mécanismes de rattrapage existaient déjà mais n'étaient armés que
 * par des composants de page :
 *  · l'outbox des captures, par `useOutbox` — donc uniquement sur la page
 *    d'une visite précise ;
 *  · la synchro des visites locales, par la coquille /hors-ligne — donc
 *    jamais si l'on rouvrait l'application connectée.
 *
 * Conséquence : on éditait sans réseau, on fermait la PWA, on la rouvrait
 * connecté… et rien ne repartait, sans le moindre signe. Monté dans le layout,
 * ce composant arme les deux quelle que soit la page ouverte.
 */
export function OfflineSyncBoot() {
  const router = useRouter();
  const [enAttente, setEnAttente] = useState(0);
  const [enEchec, setEnEchec] = useState(0);

  useEffect(() => {
    ensureAutoFlush();
    ensureAutoSyncVisits();
  }, []);

  // Compte ce qui n'est pas encore parti, pour ne plus laisser l'utilisateur
  // dans l'ignorance — c'est l'absence de signal qui a fait croire à une perte.
  useEffect(() => {
    let vivant = true;
    const relire = async () => {
      try {
        const visites = await listLocalVisits();
        if (!vivant) return;
        setEnAttente(visites.filter((v) => v.syncState === "local" || v.syncState === "syncing").length);
        setEnEchec(visites.filter((v) => v.syncState === "error").length);
      } catch {
        // Magasin indisponible (navigation privée, quota) : on n'affiche rien
        // plutôt que d'inventer un état.
      }
    };
    void relire();
    window.addEventListener(LOCAL_VISITS_EVENT, relire);
    return () => { vivant = false; window.removeEventListener(LOCAL_VISITS_EVENT, relire); };
  }, []);

  // Une visite vient d'arriver côté serveur → la faire apparaître tout de suite.
  useEffect(() => {
    const onSynced = () => router.refresh();
    window.addEventListener(VISITS_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(VISITS_SYNCED_EVENT, onSynced);
  }, [router]);

  const total = enAttente + enEchec;
  if (total === 0) return null;

  return (
    <Link
      href="/hors-ligne"
      className="fixed left-4 z-[64] flex items-center gap-2 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition-colors"
      style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}
    >
      {enEchec > 0 ? (
        <TriangleAlert size={13} strokeWidth={2} className="text-red-400 shrink-0" />
      ) : (
        <CloudOff size={13} strokeWidth={2} className="text-amber-400 shrink-0" />
      )}
      <span>
        {enEchec > 0
          ? `${enEchec} visite${enEchec > 1 ? "s" : ""} en échec d'envoi`
          : `${enAttente} visite${enAttente > 1 ? "s" : ""} à envoyer`}
      </span>
    </Link>
  );
}
