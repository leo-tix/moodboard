"use client";

import { useMemo, useState } from "react";

export interface ProfileRow {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "USER";
  quotaBytes: number;
  usedBytes: number;
  createdAt: string;
}

interface GlobalQuota {
  maxBytes: number;
  allocatedBytes: number;
  availableBytes: number;
}

const GB = 1024 ** 3;

function fmt(bytes: number): string {
  if (bytes <= 0) return "0 Mo";
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} Go`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} Mo`;
}

export function ProfilesManager({
  initialUsers,
  adminId,
  global: initialGlobal,
}: {
  initialUsers: ProfileRow[];
  adminId: string;
  global: GlobalQuota;
}) {
  const [users, setUsers] = useState<ProfileRow[]>(initialUsers);

  // Recalcule l'allocation globale depuis la liste courante
  const global = useMemo<GlobalQuota>(() => {
    const allocated = users.reduce((s, u) => s + u.quotaBytes, 0);
    return {
      maxBytes: initialGlobal.maxBytes,
      allocatedBytes: allocated,
      availableBytes: Math.max(0, initialGlobal.maxBytes - allocated),
    };
  }, [users, initialGlobal.maxBytes]);

  const allocPct = Math.min(100, (global.allocatedBytes / global.maxBytes) * 100);

  return (
    <div className="space-y-6">
      {/* Répartition globale du bucket */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs text-[var(--text-secondary)]">Bucket R2 réparti</span>
          <span className="text-xs text-[var(--text-tertiary)]">
            {fmt(global.allocatedBytes)} / {fmt(global.maxBytes)} attribués
          </span>
        </div>
        <div className="h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
          <div
            className="h-full bg-[var(--accent,#a78bfa)] transition-all"
            style={{ width: `${allocPct}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          {fmt(global.availableBytes)} encore distribuables entre les profils.
        </p>
      </div>

      {/* Liste des profils */}
      <div className="space-y-2">
        {users.map((u) => (
          <ProfileCard
            key={u.id}
            user={u}
            isSelf={u.id === adminId}
            availableBytes={global.availableBytes}
            onUpdated={(updated) =>
              setUsers((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
            }
            onDeleted={(id) => setUsers((prev) => prev.filter((p) => p.id !== id))}
          />
        ))}
      </div>

      {/* Création d'un profil */}
      <CreateProfileForm
        availableBytes={global.availableBytes}
        onCreated={(u) => setUsers((prev) => [...prev, u])}
      />
    </div>
  );
}

function ProfileCard({
  user,
  isSelf,
  availableBytes,
  onUpdated,
  onDeleted,
}: {
  user: ProfileRow;
  isSelf: boolean;
  availableBytes: number;
  onUpdated: (u: ProfileRow) => void;
  onDeleted: (id: string) => void;
}) {
  const [quotaGb, setQuotaGb] = useState((user.quotaBytes / GB).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const usedPct = user.quotaBytes > 0
    ? Math.min(100, (user.usedBytes / user.quotaBytes) * 100)
    : 0;
  const near = usedPct >= 80;

  // Ce que ce profil peut monter au maximum : dispo global + son propre quota actuel
  const maxAssignable = availableBytes + user.quotaBytes;

  async function saveQuota() {
    setError("");
    const bytes = Math.round(parseFloat(quotaGb) * GB);
    if (!Number.isFinite(bytes) || bytes <= 0) {
      setError("Quota invalide");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotaBytes: bytes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Échec");
        return;
      }
      onUpdated(data as ProfileRow);
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Échec de suppression");
        setConfirming(false);
        return;
      }
      onDeleted(user.id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--text-primary)] truncate">
              {user.name || user.email}
            </span>
            {user.role === "ADMIN" && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent,#a78bfa)]/15 text-[var(--accent,#a78bfa)]">
                Admin
              </span>
            )}
            {isSelf && (
              <span className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">
                (toi)
              </span>
            )}
          </div>
          {user.name && (
            <p className="text-xs text-[var(--text-tertiary)] truncate">{user.email}</p>
          )}
        </div>
        {!isSelf && (
          confirming ? (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={del}
                disabled={saving}
                className="text-[11px] px-2 py-1 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
              >
                Confirmer
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-[11px] px-2 py-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              >
                Annuler
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="text-[11px] px-2 py-1 rounded text-[var(--text-tertiary)] hover:text-red-400 transition-colors flex-shrink-0"
            >
              Supprimer
            </button>
          )
        )}
      </div>

      {/* Barre d'usage */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {fmt(user.usedBytes)} utilisés
          </span>
          <span className={`text-[11px] ${near ? "text-amber-400" : "text-[var(--text-tertiary)]"}`}>
            {usedPct.toFixed(0)}%
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
          <div
            className={`h-full transition-all ${near ? "bg-amber-400" : "bg-[var(--accent,#a78bfa)]"}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
      </div>

      {/* Édition du quota */}
      <div className="mt-3 flex items-center gap-2">
        <label className="text-[11px] text-[var(--text-tertiary)]">Quota</label>
        <input
          type="number"
          min="0"
          step="0.25"
          value={quotaGb}
          onChange={(e) => setQuotaGb(e.target.value)}
          className="w-20 px-2 py-1 text-xs rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-strong)]"
        />
        <span className="text-[11px] text-[var(--text-tertiary)]">Go</span>
        <span className="text-[10px] text-[var(--text-tertiary)]">
          (max {(maxAssignable / GB).toFixed(2)} Go)
        </span>
        <button
          onClick={saveQuota}
          disabled={saving}
          className="ml-auto text-[11px] px-2.5 py-1 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors disabled:opacity-50"
        >
          {saving ? "…" : "Enregistrer"}
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

function CreateProfileForm({
  availableBytes,
  onCreated,
}: {
  availableBytes: number;
  onCreated: (u: ProfileRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [quotaGb, setQuotaGb] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    const bytes = Math.round(parseFloat(quotaGb) * GB);
    if (!email.trim()) return setError("Email requis");
    if (password.length < 8) return setError("Mot de passe : 8 caractères minimum");
    if (!Number.isFinite(bytes) || bytes <= 0) return setError("Quota invalide");

    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() || undefined, quotaBytes: bytes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Échec de création");
        return;
      }
      onCreated(data as ProfileRow);
      setEmail(""); setName(""); setPassword(""); setQuotaGb("1"); setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-2.5 text-xs rounded-lg border border-dashed border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors"
      >
        + Nouveau profil
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3">
      <p className="text-xs font-medium text-[var(--text-primary)]">Nouveau profil</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="email"
          placeholder="email@exemple.fr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="px-2.5 py-1.5 text-xs rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-strong)]"
        />
        <input
          type="text"
          placeholder="Nom (optionnel)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="px-2.5 py-1.5 text-xs rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-strong)]"
        />
        <input
          type="password"
          placeholder="Mot de passe (min 8)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-2.5 py-1.5 text-xs rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-strong)]"
        />
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="0.25"
            value={quotaGb}
            onChange={(e) => setQuotaGb(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-strong)]"
          />
          <span className="text-[11px] text-[var(--text-tertiary)] whitespace-nowrap">
            Go / {(availableBytes / GB).toFixed(2)} dispo
          </span>
        </div>
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded bg-[var(--accent,#a78bfa)] text-black font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? "Création…" : "Créer le profil"}
        </button>
        <button
          onClick={() => { setOpen(false); setError(""); }}
          className="text-xs px-3 py-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
