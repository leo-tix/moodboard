"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, Images, Landmark, HardDrive } from "lucide-react";
import { useOutbox } from "@/lib/offline/useOutbox";
import { flushOutbox } from "@/lib/offline/outbox";

// ── Coquille HORS LIGNE ────────────────────────────────────────────────────
// Volontairement placée HORS du groupe (app) : le layout de ce groupe appelle
// `auth()` côté serveur et redirige vers /login, ce qui est impossible sans
// réseau. Cette page est donc entièrement rendue côté CLIENT et ne fait aucun
// appel serveur — c'est ce qui lui permet d'exister quand il n'y a pas de
// connexion (cf. docs/carnet-hors-ligne.md §1b).
//
// Le service worker la sert en REPLI DE NAVIGATION : toute navigation qui
// échoue faute de réseau atterrit ici au lieu de la page d'erreur du
// navigateur. Elle grandira aux phases suivantes pour afficher les visites en
// cache local et permettre d'en créer une.

function formatMo(bytes: number) {
  return `${(bytes / 1048576).toFixed(0)} Mo`;
}

// Le serveur répond-il VRAIMENT ? `navigator.onLine` ne dit qu'une chose :
// l'appareil est associé à un réseau. Sur le wifi d'un musée — connecté mais
// sans accès réel — il vaut `true` alors que rien ne passe. On sonde donc une
// ressource publique et minuscule, avec un délai court.
async function serveurJoignable(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`/manifest.json?ping=${Date.now()}`, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export default function OfflinePage() {
  const { count } = useOutbox();
  const [flushing, setFlushing] = useState(false);
  // `null` = sondage en cours (on n'affiche alors aucune affirmation tranchée).
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let vivant = true;
    const sonder = () => { serveurJoignable().then((ok) => { if (vivant) setOnline(ok); }); };
    sonder();
    // Re-sonde quand l'appareil signale un changement, et régulièrement tant
    // que la page est affichée (une connexion instable revient sans prévenir).
    const iv = setInterval(sonder, 10000);
    window.addEventListener("online", sonder);
    window.addEventListener("offline", sonder);
    return () => {
      vivant = false;
      clearInterval(iv);
      window.removeEventListener("online", sonder);
      window.removeEventListener("offline", sonder);
    };
  }, []);
  // Stockage local : place occupée et protection contre l'éviction. C'est le
  // risque n°1 du hors-ligne — une visite entière peut représenter 50 à 100 Mo
  // de photos en attente (cf. docs/carnet-hors-ligne.md §6).
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        const persisted = (await navigator.storage?.persisted?.()) ?? false;
        if (est) setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0, persisted });
      } catch { /* API absente : on n'affiche simplement rien */ }
    })();
  }, []);

  const retry = async () => {
    setFlushing(true);
    try { await flushOutbox(); } catch { /* la file gère ses propres erreurs */ }
    setFlushing(false);
  };

  return (
    <main className="min-h-screen bg-[var(--bg-base)] px-5 py-10 flex flex-col items-center">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center gap-3">
          <span className="w-12 h-12 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center">
            <CloudOff size={22} strokeWidth={1.75} className="text-[var(--text-secondary)]" />
          </span>
          <h1 className="font-serif text-2xl text-[var(--text-primary)]">
            {online === null ? "Vérification du réseau…" : online ? "Connexion retrouvée" : "Mode hors ligne"}
          </h1>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            {online === null
              ? "On regarde si le serveur répond."
              : online
                ? "Le réseau est de retour. Tes captures en attente repartent automatiquement."
                : "Le serveur est injoignable. Tes captures sont conservées sur l'appareil et repartiront toutes seules dès que la connexion reviendra."}
          </p>
        </div>

        {/* File d'attente */}
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-[var(--text-primary)]">
              {count === 0
                ? "Rien en attente"
                : `${count} capture${count > 1 ? "s" : ""} en attente d'envoi`}
            </span>
            {count > 0 && online === true && (
              <button
                onClick={retry}
                disabled={flushing}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-50"
              >
                <RefreshCw size={13} strokeWidth={2} className={flushing ? "animate-spin" : undefined} />
                Envoyer
              </button>
            )}
          </div>
          {count > 0 && (
            <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
              Rien n&apos;est perdu : photos et mémos vocaux sont stockés sur l&apos;appareil
              jusqu&apos;à confirmation du serveur.
            </p>
          )}
        </div>

        {/* Stockage local */}
        {storage && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-1.5">
            <span className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <HardDrive size={14} strokeWidth={1.75} className="text-[var(--text-secondary)]" />
              Stockage sur l&apos;appareil
            </span>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              {formatMo(storage.usage)} utilisés
              {storage.quota > 0 && ` sur ${formatMo(storage.quota)} disponibles`}.
            </p>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              {storage.persisted
                ? "Stockage protégé : le navigateur ne peut pas l'effacer pour libérer de la place."
                : "Stockage non protégé — le navigateur pourrait l'effacer sous forte pression disque."}
            </p>
          </div>
        )}

        {/* Retour à l'app */}
        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/visites"
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <Landmark size={15} strokeWidth={1.75} /> Visites
          </Link>
          <Link
            href="/library"
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <Images size={15} strokeWidth={1.75} /> Bibliothèque
          </Link>
        </div>
        {online === false && (
          <p className="text-[11px] text-[var(--text-tertiary)] text-center">
            Ces pages ne s&apos;afficheront qu&apos;une fois la connexion revenue.
          </p>
        )}
      </div>
    </main>
  );
}
