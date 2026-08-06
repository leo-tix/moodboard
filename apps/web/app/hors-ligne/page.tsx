"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, Images, Landmark, HardDrive, Plus, ChevronRight, Check, TriangleAlert, Loader2 } from "lucide-react";
import { useOutbox } from "@/lib/offline/useOutbox";
import { flushOutbox } from "@/lib/offline/outbox";
import { OfflineVisitEditor } from "@/components/offline/OfflineVisitEditor";
import {
  createLocalVisit,
  listLocalVisits,
  pruneSyncedVisits,
  LOCAL_VISITS_EVENT,
  type LocalVisit,
} from "@/lib/offline/localVisits";
import { syncAllLocalVisits, syncLocalVisit } from "@/lib/offline/syncVisits";

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
  const [visits, setVisits] = useState<LocalVisit[]>([]);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Les visites locales sont la source de vérité de cette page : on les
  // recharge à chaque mutation du magasin (événement émis par localVisits).
  useEffect(() => {
    const recharger = () => { listLocalVisits().then(setVisits).catch(() => {}); };
    // Purge des visites CONFIRMÉES et anciennes (jamais des non synchronisées),
    // au montage : c'est le moment où l'on est sûr de ne rien interrompre.
    pruneSyncedVisits().then(recharger).catch(recharger);
    window.addEventListener(LOCAL_VISITS_EVENT, recharger);
    return () => window.removeEventListener(LOCAL_VISITS_EVENT, recharger);
  }, []);

  // Dès que le serveur redevient joignable, on tente la synchro. Le verrou est
  // dans syncAllLocalVisits : deux déclenchements ne peuvent pas se superposer.
  useEffect(() => {
    if (online !== true) return;
    setSyncing(true);
    syncAllLocalVisits().finally(() => setSyncing(false));
  }, [online]);

  // Déclare au service worker les fichiers que CETTE page a chargés, pour
  // qu'elle puisse se réafficher hors ligne. Les URL viennent de ce qui a
  // réellement transité, pas d'une supposition sur le HTML.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const sw = navigator.serviceWorker?.controller;
        if (!sw) return;
        const urls = performance
          .getEntriesByType("resource")
          .map((r) => r.name)
          .filter((u) => u.startsWith(location.origin) && u.includes("/_next/"));
        if (urls.length) sw.postMessage({ type: "cache-urls", urls });
      } catch { /* sans conséquence : le repli reste la page en cache */ }
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let vivant = true;
    // Garde-fou : si la sonde ne rendait jamais la main, l'écran restait bloqué
    // sur « Vérification du réseau… ». Au-delà du délai, on tranche : hors ligne.
    const secours = setTimeout(() => { if (vivant) setOnline((v) => (v === null ? false : v)); }, 6000);
    const sonder = () => { serveurJoignable().then((ok) => { if (vivant) { clearTimeout(secours); setOnline(ok); } }); };
    sonder();
    // Re-sonde quand l'appareil signale un changement, et régulièrement tant
    // que la page est affichée (une connexion instable revient sans prévenir).
    const iv = setInterval(sonder, 10000);
    window.addEventListener("online", sonder);
    window.addEventListener("offline", sonder);
    return () => {
      vivant = false;
      clearTimeout(secours);
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

  const visiteOuverte = ouverte ? visits.find((v) => v.localId === ouverte) ?? null : null;

  if (visiteOuverte) {
    return (
      <main className="min-h-screen bg-[var(--bg-base)] px-5 py-8 flex flex-col items-center">
        <div className="w-full max-w-md">
          <OfflineVisitEditor
            visit={visiteOuverte}
            onBack={() => setOuverte(null)}
            onChange={(v) => setVisits((prev) => prev.map((x) => (x.localId === v.localId ? v : x)))}
          />
        </div>
      </main>
    );
  }

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

        {/* Visites sur l'appareil */}
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-[var(--text-primary)]">Visites sur l&apos;appareil</span>
            <button
              onClick={() => setCreation(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <Plus size={13} strokeWidth={2} /> Nouvelle
            </button>
          </div>

          {visits.length === 0 ? (
            <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
              Tu peux créer une visite ici même sans réseau, et la remplir au fil de
              la journée. Elle partira toute seule au retour de la connexion.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {visits.map((v) => (
                <li key={v.localId}>
                  <button
                    onClick={() => setOuverte(v.localId)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors text-left"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-[var(--text-primary)] truncate">
                        {v.exhibition || v.place}
                      </span>
                      <span className="block text-[10px] text-[var(--text-tertiary)]">
                        {v.blocks.length} élément{v.blocks.length > 1 ? "s" : ""}
                        {v.syncState === "synced" && " · synchronisée"}
                        {v.syncState === "error" && " · échec d'envoi"}
                        {v.syncState === "syncing" && " · envoi en cours"}
                      </span>
                    </span>
                    {v.syncState === "synced" ? (
                      <Check size={14} strokeWidth={2} className="text-emerald-400 shrink-0" />
                    ) : v.syncState === "error" ? (
                      <TriangleAlert size={14} strokeWidth={2} className="text-red-400 shrink-0" />
                    ) : v.syncState === "syncing" || syncing ? (
                      <Loader2 size={14} className="animate-spin text-[var(--text-tertiary)] shrink-0" />
                    ) : (
                      <ChevronRight size={14} strokeWidth={2} className="text-[var(--text-tertiary)] shrink-0" />
                    )}
                  </button>
                  {/* Motif d'échec + reprise manuelle. Il était stocké mais
                      jamais affiché : impossible pour l'utilisateur de savoir
                      pourquoi une visite restait bloquée. */}
                  {v.syncState === "error" && (
                    <div className="mt-1 ml-2.5 mb-1.5 space-y-1">
                      {v.lastError && (
                        <p className="text-[10px] text-red-400 leading-snug">{v.lastError}</p>
                      )}
                      <button
                        onClick={() => { setSyncing(true); syncLocalVisit(v.localId).finally(() => setSyncing(false)); }}
                        disabled={syncing || online !== true}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-40"
                      >
                        <RefreshCw size={11} strokeWidth={2} className={syncing ? "animate-spin" : undefined} />
                        Réessayer
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
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
        {/* Création d'une visite — hors ligne, aucune requête serveur : la visite
            naît sur l'appareil avec un identifiant local et sera créée côté
            serveur au moment de la synchro (cf. docs/carnet-hors-ligne.md §4). */}
        {creation && (
          <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setCreation(false)}>
            <form
              onClick={(e) => e.stopPropagation()}
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const place = String(fd.get("place") ?? "").trim();
                if (!place) return;
                const v = await createLocalVisit({
                  place,
                  exhibition: String(fd.get("exhibition") ?? "").trim() || null,
                  visitDate: String(fd.get("visitDate") ?? "") || new Date().toISOString().slice(0, 10),
                });
                setCreation(false);
                setOuverte(v.localId);
              }}
              className="w-full max-w-md rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 space-y-3"
            >
              <p className="text-sm text-[var(--text-primary)]">Nouvelle visite</p>
              <input name="place" autoFocus required placeholder="Lieu (musée, galerie…)"
                className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)]" />
              <input name="exhibition" placeholder="Exposition (facultatif)"
                className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)]" />
              <input name="visitDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)}
                className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)]" />
              <p className="text-[10px] text-[var(--text-tertiary)]">
                Le lieu exact sur la carte pourra être précisé une fois en ligne.
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCreation(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                  Annuler
                </button>
                <button type="submit"
                  className="px-3 py-1.5 rounded-lg text-xs bg-[var(--text-primary)] text-[var(--bg-base)]">
                  Créer
                </button>
              </div>
            </form>
          </div>
        )}

        {online === false && (
          <p className="text-[11px] text-[var(--text-tertiary)] text-center">
            Ces pages ne s&apos;afficheront qu&apos;une fois la connexion revenue.
          </p>
        )}
      </div>
    </main>
  );
}
