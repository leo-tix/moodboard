"use client";

import { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getImageUrl } from "@/lib/storage/urls";
import { logout } from "@/app/(app)/settings/account/actions";

interface StorageInfo {
  usedBytes: number;
  maxBytes: number;
  usedPercent: number;
  isNearLimit: boolean;
  formatted: { used: string; max: string; remaining: string };
}

interface Props {
  initialName: string;
  initialEmail: string;
  initialImage: string | null;
  memberSince: string;
  storage: StorageInfo;
}

const lbl = "block text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5";
const fld =
  "w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] focus:border-[var(--border-default)] text-[var(--text-primary)] text-sm rounded-md px-3 py-2 focus:outline-none transition-colors placeholder:text-[var(--text-tertiary)]";

function initialsOf(name: string, email: string): string {
  const base = name.trim() || email;
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

export function AccountSettings({
  initialName,
  initialEmail,
  initialImage,
  memberSince,
  storage,
}: Props) {
  const router = useRouter();

  // ── Profil ──
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [profileStatus, setProfileStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [profileError, setProfileError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveProfile = useCallback(async (patch: { name?: string; email?: string }) => {
    setProfileStatus("saving");
    setProfileError(null);
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProfileError(data.error ?? "Erreur");
        setProfileStatus("idle");
        return;
      }
      setProfileStatus("saved");
      setTimeout(() => setProfileStatus("idle"), 2000);
      router.refresh(); // rafraîchit l'avatar/nom de la sidebar
    } catch {
      setProfileError("Erreur réseau");
      setProfileStatus("idle");
    }
  }, [router]);

  const onNameChange = (v: string) => {
    setName(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveProfile({ name: v.trim() }), 700);
  };

  const onEmailBlur = () => {
    const trimmed = email.trim();
    if (trimmed && trimmed !== initialEmail) saveProfile({ email: trimmed });
  };

  // ── Avatar ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState(initialImage);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de re-sélectionner le même fichier
    if (!file) return;
    setAvatarBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/account/avatar", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.image) {
        setImage(data.image);
        router.refresh();
      }
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    try {
      await fetch("/api/account/avatar", { method: "DELETE" });
      setImage(null);
      router.refresh();
    } finally {
      setAvatarBusy(false);
    }
  };

  // ── Mot de passe ──
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwStatus, setPwStatus] = useState<"idle" | "saving" | "done">("idle");
  const [pwError, setPwError] = useState<string | null>(null);

  const changePassword = async () => {
    setPwError(null);
    if (newPassword.length < 8) {
      setPwError("Le nouveau mot de passe doit faire au moins 8 caractères");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("Les deux mots de passe ne correspondent pas");
      return;
    }
    setPwStatus("saving");
    try {
      const res = await fetch("/api/account/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwError(data.error ?? "Erreur");
        setPwStatus("idle");
        return;
      }
      setPwStatus("done");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPwStatus("idle"), 2500);
    } catch {
      setPwError("Erreur réseau");
      setPwStatus("idle");
    }
  };

  const memberDate = new Date(memberSince).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });
  const barPct = Math.min(100, Math.round(storage.usedPercent * 100));

  return (
    <div className="space-y-9">
      {/* ── Avatar + identité ── */}
      <section className="flex items-center gap-4">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={avatarBusy}
          className="relative w-20 h-20 rounded-full overflow-hidden bg-[var(--bg-elevated)] border border-[var(--border-default)] flex items-center justify-center flex-shrink-0 group"
          title="Changer la photo de profil"
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getImageUrl(image)} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xl font-medium text-[var(--text-secondary)]">
              {initialsOf(name, email)}
            </span>
          )}
          <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px]">
            {avatarBusy ? "…" : "Modifier"}
          </span>
        </button>
        <div className="min-w-0">
          <p className="text-sm text-[var(--text-primary)] truncate">{name || "Sans nom"}</p>
          <p className="text-xs text-[var(--text-tertiary)] truncate">{email}</p>
          <div className="flex items-center gap-3 mt-1.5">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={avatarBusy}
              className="text-[11px] text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity disabled:opacity-40"
            >
              Changer la photo
            </button>
            {image && (
              <button
                onClick={removeAvatar}
                disabled={avatarBusy}
                className="text-[11px] text-[var(--text-tertiary)] hover:text-red-400 transition-colors disabled:opacity-40"
              >
                Retirer
              </button>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="hidden"
          onChange={onPickAvatar}
        />
      </section>

      {/* ── Profil ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-widest">Profil</p>
          {profileStatus === "saving" && (
            <span className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full border border-current border-t-transparent animate-spin" />
              Sauvegarde…
            </span>
          )}
          {profileStatus === "saved" && (
            <span className="text-[10px] text-[var(--text-tertiary)]">Enregistré ✓</span>
          )}
        </div>
        <div>
          <label className={lbl}>Nom</label>
          <input className={fld} value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Ton nom" />
        </div>
        <div>
          <label className={lbl}>Email</label>
          <input
            type="email"
            className={fld}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={onEmailBlur}
            placeholder="toi@exemple.com"
          />
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
            Sert d&apos;identifiant de connexion. Le changement prend effet à la prochaine connexion.
          </p>
        </div>
        {profileError && <p className="text-xs text-red-400">{profileError}</p>}
      </section>

      {/* ── Mot de passe ── */}
      <section className="space-y-4">
        <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-widest">Mot de passe</p>
        <div>
          <label className={lbl}>Mot de passe actuel</label>
          <input type="password" className={fld} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Nouveau</label>
            <input type="password" className={fld} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <div>
            <label className={lbl}>Confirmer</label>
            <input type="password" className={fld} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </div>
        </div>
        {pwError && <p className="text-xs text-red-400">{pwError}</p>}
        <button
          onClick={changePassword}
          disabled={pwStatus === "saving" || !currentPassword || !newPassword || !confirmPassword}
          className="px-4 py-2 text-sm bg-[var(--text-primary)] text-[var(--bg-base)] rounded-md font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {pwStatus === "saving" ? "Modification…" : pwStatus === "done" ? "Modifié ✓" : "Changer le mot de passe"}
        </button>
      </section>

      {/* ── Stockage ── */}
      <section className="space-y-3">
        <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-widest">Stockage</p>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-[var(--text-secondary)]">
            {storage.formatted.used} <span className="text-[var(--text-tertiary)]">/ {storage.formatted.max}</span>
          </span>
          <span className={storage.isNearLimit ? "text-amber-400" : "text-[var(--text-tertiary)]"}>
            {storage.formatted.remaining} restant
          </span>
        </div>
        <div className="h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${storage.isNearLimit ? "bg-amber-400" : "bg-[var(--accent,#a78bfa)]"}`}
            style={{ width: `${Math.max(2, barPct)}%` }}
          />
        </div>
        <p className="text-[10px] text-[var(--text-tertiary)]">{barPct}% utilisé</p>
      </section>

      {/* ── Bas de page : membre depuis + déconnexion ── */}
      <section className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between">
        <p className="text-[11px] text-[var(--text-tertiary)]">Membre depuis le {memberDate}</p>
        <form action={logout}>
          <button
            type="submit"
            className="text-xs text-[var(--text-secondary)] hover:text-red-400 transition-colors border border-[var(--border-subtle)] hover:border-red-400/40 px-3 py-1.5 rounded-lg"
          >
            Se déconnecter
          </button>
        </form>
      </section>
    </div>
  );
}
