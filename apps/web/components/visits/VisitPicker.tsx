"use client";

import { useEffect, useRef, useState } from "react";
import { Landmark, X } from "lucide-react";
import { PlaceAutocomplete, type PlaceGeo } from "@/components/visits/PlaceAutocomplete";

export interface VisitRef {
  id: string;
  place: string;
  exhibition: string | null;
  visitDate: string; // ISO
}

interface VisitPickerProps {
  inspirationId: string;
  initialVisit?: VisitRef | null;
}

const lbl = "block text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1";
const fld =
  "w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-[11px] rounded px-2 py-1.5 focus:outline-none focus:border-[var(--border-default)] transition-colors placeholder:text-[var(--text-tertiary)]";

function visitLabel(v: VisitRef): string {
  const date = new Date(v.visitDate).toLocaleDateString("fr-FR", {
    day: "numeric", month: "short", year: "numeric",
  });
  return v.exhibition ? `${v.place} — ${v.exhibition} · ${date}` : `${v.place} · ${date}`;
}

// Section "Visite" du MetadataPanel : affiche la visite actuelle (chip ✕ pour
// détacher), et permet de rattacher l'image à une visite existante ou d'en
// créer une nouvelle inline. L'attache/détache passe par PATCH /api/visits/[id]
// (add/removeInspirationIds) — aucun changement côté API inspirations.
export function VisitPicker({ inspirationId, initialVisit }: VisitPickerProps) {
  const [visit, setVisit] = useState<VisitRef | null>(initialVisit ?? null);
  const [open, setOpen] = useState(false);
  const [visits, setVisits] = useState<VisitRef[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newPlace, setNewPlace] = useState("");
  const [newExhibition, setNewExhibition] = useState("");
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newGeo, setNewGeo] = useState<PlaceGeo | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fermer le dropdown au clic extérieur
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Charger la liste des visites à l'ouverture
  useEffect(() => {
    if (!open || visits !== null) return;
    fetch("/api/visits")
      .then((r) => r.json())
      .then((list: (VisitRef & { _count?: unknown })[]) =>
        setVisits(list.map((v) => ({
          id: v.id, place: v.place, exhibition: v.exhibition, visitDate: v.visitDate,
        })))
      )
      .catch(() => setVisits([]));
  }, [open, visits]);

  const attach = async (target: VisitRef) => {
    setBusy(true);
    try {
      // Détacher de l'ancienne visite si différente
      if (visit && visit.id !== target.id) {
        await fetch(`/api/visits/${visit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ removeInspirationIds: [inspirationId] }),
        });
      }
      await fetch(`/api/visits/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addInspirationIds: [inspirationId] }),
      });
      setVisit(target);
      setOpen(false);
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  const detach = async () => {
    if (!visit) return;
    setBusy(true);
    try {
      await fetch(`/api/visits/${visit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeInspirationIds: [inspirationId] }),
      });
      setVisit(null);
    } finally {
      setBusy(false);
    }
  };

  const createAndAttach = async () => {
    if (!newPlace.trim()) return;
    setBusy(true);
    try {
      // Détacher de l'ancienne visite d'abord
      if (visit) {
        await fetch(`/api/visits/${visit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ removeInspirationIds: [inspirationId] }),
        });
      }
      const res = await fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place: newPlace.trim(),
          exhibition: newExhibition.trim() || undefined,
          visitDate: newDate,
          inspirationIds: [inspirationId],
          ...(newGeo
            ? { latitude: newGeo.latitude, longitude: newGeo.longitude, address: newGeo.address }
            : {}),
        }),
      });
      const created = await res.json();
      if (res.ok && created.id) {
        setVisit({
          id: created.id,
          place: created.place,
          exhibition: created.exhibition,
          visitDate: created.visitDate,
        });
        setVisits(null); // recharger la liste la prochaine fois
        setOpen(false);
        setCreating(false);
        setNewPlace("");
        setNewExhibition("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center justify-between mb-1">
        <p className={lbl}>Visite</p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] md:text-[9px] py-1.5 md:py-0 px-1 text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity"
        >
          {visit ? "Changer" : "+ Rattacher"}
        </button>
      </div>

      {visit ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-[var(--bg-elevated)] text-[var(--text-secondary)] max-w-full">
          <span className="truncate inline-flex items-center gap-1.5"><Landmark size={13} strokeWidth={1.75} /> {visitLabel(visit)}</span>
          <button
            type="button"
            onClick={detach}
            disabled={busy}
            className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity leading-none flex-shrink-0 inline-flex items-center"
            title="Détacher de cette visite"
          >
            <X size={12} strokeWidth={2} />
          </button>
        </span>
      ) : (
        <p className="text-[10px] text-[var(--text-tertiary)]">—</p>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl overflow-hidden">
          {!creating ? (
            <>
              <div className="max-h-48 overflow-y-auto">
                {visits === null ? (
                  <p className="px-3 py-2.5 text-[10px] text-[var(--text-tertiary)]">Chargement…</p>
                ) : visits.length === 0 ? (
                  <p className="px-3 py-2.5 text-[10px] text-[var(--text-tertiary)]">Aucune visite existante</p>
                ) : (
                  visits.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      disabled={busy}
                      onClick={() => attach(v)}
                      className={`w-full text-left px-3 py-2 text-[11px] transition-colors truncate ${
                        visit?.id === v.id
                          ? "text-[var(--text-primary)] bg-[var(--bg-surface)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {visitLabel(v)}
                    </button>
                  ))
                )}
              </div>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full text-left px-3 py-2 text-[10px] text-[var(--accent,#a78bfa)] border-t border-[var(--border-subtle)] hover:bg-[var(--bg-surface)] transition-colors"
              >
                + Nouvelle visite
              </button>
            </>
          ) : (
            <div className="p-3 space-y-2">
              <PlaceAutocomplete
                className={fld}
                placeholder="Lieu *"
                value={newPlace}
                onChange={setNewPlace}
                onSelectGeo={setNewGeo}
              />
              <input
                className={fld}
                placeholder="Exposition (optionnel)"
                value={newExhibition}
                onChange={(e) => setNewExhibition(e.target.value)}
              />
              <input
                type="date"
                className={fld}
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors px-2 py-1"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={createAndAttach}
                  disabled={busy || !newPlace.trim()}
                  className="text-[10px] text-[var(--bg-base)] bg-[var(--text-primary)] rounded px-2.5 py-1 disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  {busy ? "…" : "Créer et rattacher"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
