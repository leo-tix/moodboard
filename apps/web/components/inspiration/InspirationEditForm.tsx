"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

interface InspirationEditFormProps {
  id: string;
  initialData: {
    title: string;
    description: string;
    author: string;
    studio: string;
    year?: number;
    country: string;
    notes: string;
    sourceUrl: string;
  };
}

export function InspirationEditForm({ id, initialData }: InspirationEditFormProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(initialData);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const update = (field: string, value: string | number) =>
    setData((prev) => ({ ...prev, [field]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/inspirations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, year: data.year || undefined }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
      >
        Modifier les métadonnées →
      </button>
    );
  }

  const fieldClass =
    "w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-[var(--border-default)] transition-colors placeholder:text-[var(--text-tertiary)]";
  const labelClass = "block text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-1";

  return (
    <div className="border-t border-[var(--border-subtle)] pt-4 space-y-3">
      <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest">
        Édition
      </p>

      <div>
        <label className={labelClass}>Titre</label>
        <input className={fieldClass} value={data.title} onChange={(e) => update("title", e.target.value)} />
      </div>

      <div>
        <label className={labelClass}>Description</label>
        <textarea
          className={`${fieldClass} resize-none`}
          rows={3}
          value={data.description}
          onChange={(e) => update("description", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Auteur</label>
          <input className={fieldClass} value={data.author} onChange={(e) => update("author", e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Studio</label>
          <input className={fieldClass} value={data.studio} onChange={(e) => update("studio", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Année</label>
          <input
            type="number"
            className={fieldClass}
            value={data.year ?? ""}
            onChange={(e) => update("year", parseInt(e.target.value) || 0)}
            placeholder="2024"
          />
        </div>
        <div>
          <label className={labelClass}>Pays</label>
          <input className={fieldClass} value={data.country} onChange={(e) => update("country", e.target.value)} />
        </div>
      </div>

      <div>
        <label className={labelClass}>Source URL</label>
        <input
          type="url"
          className={fieldClass}
          value={data.sourceUrl}
          onChange={(e) => update("sourceUrl", e.target.value)}
          placeholder="https://"
        />
      </div>

      <div>
        <label className={labelClass}>Notes personnelles</label>
        <textarea
          className={`${fieldClass} resize-none`}
          rows={3}
          value={data.notes}
          onChange={(e) => update("notes", e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        >
          Fermer
        </button>
        <Button size="sm" onClick={save} loading={saving}>
          {saved ? "Sauvegardé ✓" : "Sauvegarder"}
        </Button>
      </div>
    </div>
  );
}
