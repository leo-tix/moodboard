"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

/** Étapes du formulaire : identifiants, puis second facteur si le compte l'exige. */
type Step = "credentials" | "twoFactor";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<Step>("credentials");
  const [totp, setTotp] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function attempt(second?: { totp?: string; recoveryCode?: string }) {
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      totp: second?.totp ?? "",
      recoveryCode: second?.recoveryCode ?? "",
      redirect: false,
    });

    if (result?.error) {
      // `code` vient des erreurs typées de lib/auth/errors.ts.
      switch (result.code) {
        case "2fa_required":
          setStep("twoFactor");
          setError("");
          break;
        case "2fa_invalid":
          setError(
            useRecovery
              ? "Code de secours invalide ou déjà utilisé."
              : "Code incorrect. Vérifie l'heure de ton téléphone et réessaie.",
          );
          break;
        case "too_many_attempts":
          setError("Trop de tentatives. Réessaie dans une quinzaine de minutes.");
          break;
        default:
          setError("Email ou mot de passe incorrect.");
          setStep("credentials");
      }
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step === "credentials") {
      await attempt();
      return;
    }
    await attempt(useRecovery ? { recoveryCode } : { totp });
  }

  function backToCredentials() {
    setStep("credentials");
    setTotp("");
    setRecoveryCode("");
    setUseRecovery(false);
    setError("");
  }

  const fieldClass =
    "w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[var(--border-strong)] transition-colors";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-sm px-8"
      >
        {/* Logo */}
        <div className="mb-12 text-center">
          <span className="text-[var(--text-primary)] text-xl tracking-[0.2em] uppercase font-light">
            Moodboard
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {step === "credentials" ? (
            <>
              <div>
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  className={fieldClass}
                />
              </div>

              <div>
                <input
                  type="password"
                  placeholder="Mot de passe"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className={fieldClass}
                />
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--text-secondary)] text-center leading-relaxed">
                {useRecovery
                  ? "Saisis l'un de tes codes de secours."
                  : "Saisis le code à 6 chiffres de ton application d'authentification."}
              </p>

              {useRecovery ? (
                <input
                  type="text"
                  placeholder="XXXXX-XXXXX"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  spellCheck={false}
                  className={`${fieldClass} text-center tracking-[0.2em] uppercase`}
                />
              ) : (
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  className={`${fieldClass} text-center tracking-[0.4em] text-lg`}
                />
              )}

              <div className="flex items-center justify-between text-[11px] text-[var(--text-tertiary)]">
                <button
                  type="button"
                  onClick={backToCredentials}
                  className="hover:text-[var(--text-secondary)] transition-colors"
                >
                  ← Changer de compte
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUseRecovery((v) => !v);
                    setError("");
                  }}
                  className="hover:text-[var(--text-secondary)] transition-colors"
                >
                  {useRecovery ? "Utiliser l'application" : "Code de secours"}
                </button>
              </div>
            </>
          )}

          {error && <p className="text-red-400 text-xs text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[var(--text-primary)] text-[var(--bg-base)] rounded-md py-3 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 mt-2"
          >
            {loading ? "Connexion…" : step === "credentials" ? "Entrer" : "Valider"}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
