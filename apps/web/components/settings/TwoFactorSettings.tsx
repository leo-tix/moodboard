"use client";

import Image from "next/image";
import { useState } from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";

/**
 * Réglage de la double authentification (TOTP), section « Sécurité » du compte.
 *
 * Parcours d'activation en trois temps :
 *  1. mot de passe → le serveur prépare un secret et renvoie le QR code ;
 *  2. premier code à 6 chiffres → activation effective ;
 *  3. affichage des codes de secours, une seule et unique fois.
 */

type Status = {
  enabled: boolean;
  pending: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
};

interface Props {
  initialStatus: Status;
}

const lbl = "block text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5";
const fld =
  "w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] focus:border-[var(--border-default)] text-[var(--text-primary)] text-sm rounded-md px-3 py-2 focus:outline-none transition-colors placeholder:text-[var(--text-tertiary)]";
const btnPrimary =
  "px-4 py-2 text-sm bg-[var(--text-primary)] text-[var(--bg-base)] rounded-md font-medium hover:opacity-90 disabled:opacity-40 transition-opacity";
const btnGhost =
  "px-4 py-2 text-sm text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-md hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-colors disabled:opacity-40";

type Phase = "idle" | "password" | "verify" | "codes" | "disable" | "regenerate";

export function TwoFactorSettings({ initialStatus }: Props) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [qr, setQr] = useState<{ qrDataUrl: string; manualKey: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  function resetForm() {
    setPassword("");
    setCode("");
    setError(null);
  }

  function closeAll() {
    resetForm();
    setQr(null);
    setRecoveryCodes(null);
    setPhase("idle");
  }

  async function post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError((data.error as string) ?? "Erreur");
        return null;
      }
      return data;
    } catch {
      setError("Erreur réseau");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startSetup() {
    const data = await post("/api/account/2fa/setup", { password });
    if (!data) return;
    setQr({ qrDataUrl: data.qrDataUrl as string, manualKey: data.manualKey as string });
    setPassword("");
    setPhase("verify");
  }

  async function confirmEnable() {
    const data = await post("/api/account/2fa/enable", { code });
    if (!data) return;
    setRecoveryCodes(data.recoveryCodes as string[]);
    setStatus({ enabled: true, pending: false, enabledAt: new Date().toISOString(), recoveryCodesLeft: 10 });
    setQr(null);
    setCode("");
    setPhase("codes");
  }

  async function disable() {
    const data = await post("/api/account/2fa/disable", { password, code });
    if (!data) return;
    setStatus({ enabled: false, pending: false, enabledAt: null, recoveryCodesLeft: 0 });
    closeAll();
  }

  async function regenerate() {
    const data = await post("/api/account/2fa/recovery-codes", { password, code });
    if (!data) return;
    setRecoveryCodes(data.recoveryCodes as string[]);
    setStatus((s) => ({ ...s, recoveryCodesLeft: 10 }));
    resetForm();
    setPhase("codes");
  }

  function copyCodes() {
    if (!recoveryCodes) return;
    navigator.clipboard.writeText(recoveryCodes.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Codes de secours (affichés une seule fois) ────────────────────────────
  if (phase === "codes" && recoveryCodes) {
    return (
      <section className="space-y-4">
        <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-widest">Codes de secours</p>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          Note ces dix codes maintenant : ils ne seront plus jamais affichés. Chacun ouvre une
          session <strong>une seule fois</strong>, si tu perds ton téléphone.
        </p>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md p-4">
          {recoveryCodes.map((c) => (
            <li key={c} className="tracking-widest">{c}</li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <button onClick={copyCodes} className={btnGhost}>
            {copied ? <span className="flex items-center gap-1.5"><Check size={14} /> Copiés</span> : <span className="flex items-center gap-1.5"><Copy size={14} /> Copier</span>}
          </button>
          <button onClick={closeAll} className={btnPrimary}>J&apos;ai noté mes codes</button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-widest">
        Double authentification
      </p>

      {/* État courant */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-[var(--text-primary)] flex items-center gap-2">
            {status.enabled ? (
              <>
                <ShieldCheck size={15} className="text-emerald-400" /> Active
              </>
            ) : (
              "Inactive"
            )}
          </p>
          <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed max-w-sm">
            {status.enabled
              ? `Un code à 6 chiffres est demandé à chaque connexion. ${status.recoveryCodesLeft} code(s) de secours restant(s).`
              : "Ajoute un code à usage unique généré par ton téléphone (Google Authenticator, 1Password, Bitwarden…) en plus du mot de passe."}
          </p>
        </div>

        {phase === "idle" && (
          <button
            onClick={() => {
              resetForm();
              setPhase(status.enabled ? "disable" : "password");
            }}
            className={status.enabled ? btnGhost : btnPrimary}
          >
            {status.enabled ? "Désactiver" : "Activer"}
          </button>
        )}
      </div>

      {/* Étape 1 — mot de passe */}
      {phase === "password" && (
        <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
          <div>
            <label className={lbl}>Confirme ton mot de passe</label>
            <input
              type="password"
              className={fld}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={startSetup} disabled={busy || !password} className={btnPrimary}>
              {busy ? "…" : "Continuer"}
            </button>
            <button onClick={closeAll} className={btnGhost}>Annuler</button>
          </div>
        </div>
      )}

      {/* Étape 2 — QR code + premier code */}
      {phase === "verify" && qr && (
        <div className="space-y-4 border-t border-[var(--border-subtle)] pt-4">
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Scanne ce QR code avec ton application d&apos;authentification, puis saisis le code
            affiché pour confirmer.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <Image
              src={qr.qrDataUrl}
              alt="QR code de configuration"
              width={160}
              height={160}
              unoptimized
              className="rounded-md bg-white p-2"
            />
            <div className="space-y-2 min-w-0">
              <p className={lbl}>Ou saisie manuelle</p>
              <code className="block text-xs font-mono text-[var(--text-secondary)] break-all">
                {qr.manualKey}
              </code>
            </div>
          </div>
          <div className="max-w-[180px]">
            <label className={lbl}>Code à 6 chiffres</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className={`${fld} text-center tracking-[0.3em]`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoComplete="one-time-code"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={confirmEnable} disabled={busy || code.length !== 6} className={btnPrimary}>
              {busy ? "…" : "Activer"}
            </button>
            <button onClick={closeAll} className={btnGhost}>Annuler</button>
          </div>
        </div>
      )}

      {/* Désactivation / régénération — mot de passe + code en cours */}
      {(phase === "disable" || phase === "regenerate") && (
        <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
          <p className="text-xs text-[var(--text-secondary)]">
            {phase === "disable"
              ? "Confirme avec ton mot de passe et un code en cours pour désactiver."
              : "Confirme pour générer une nouvelle série de codes (l'ancienne sera invalidée)."}
          </p>
          <div>
            <label className={lbl}>Mot de passe</label>
            <input
              type="password"
              className={fld}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="max-w-[180px]">
            <label className={lbl}>Code à 6 chiffres</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className={`${fld} text-center tracking-[0.3em]`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoComplete="one-time-code"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={phase === "disable" ? disable : regenerate}
              disabled={busy || !password || code.length !== 6}
              className={btnPrimary}
            >
              {busy ? "…" : phase === "disable" ? "Désactiver" : "Régénérer"}
            </button>
            <button onClick={closeAll} className={btnGhost}>Annuler</button>
          </div>
        </div>
      )}

      {/* Régénérer les codes de secours */}
      {status.enabled && phase === "idle" && (
        <button
          onClick={() => {
            resetForm();
            setPhase("regenerate");
          }}
          className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors underline underline-offset-2"
        >
          Régénérer mes codes de secours
        </button>
      )}
    </section>
  );
}
