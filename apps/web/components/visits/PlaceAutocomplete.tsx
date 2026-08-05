"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface PlaceGeo {
  latitude: number;
  longitude: number;
  address: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    country?: string;
    osm_value?: string;
  };
}

function featureLabel(f: PhotonFeature): { name: string; detail: string } {
  const p = f.properties;
  const name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || "—";
  const detail = [p.city, p.country].filter(Boolean).join(", ");
  return { name, detail };
}

interface PlaceAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  /** Appelé quand l'utilisateur sélectionne une suggestion (avec coordonnées) */
  onSelectGeo?: (geo: PlaceGeo | null) => void;
  placeholder?: string;
  className?: string;
}

// Autocomplétion de lieux via Photon (photon.komoot.io) — géocodeur
// OpenStreetMap gratuit, sans clé API, CORS ouvert. Debounce 300ms.
// Taper librement reste possible (le lieu n'est pas obligé d'exister sur OSM) ;
// sélectionner une suggestion fournit en plus lat/lon pour la mini-carte.
export function PlaceAutocomplete({
  value,
  onChange,
  onSelectGeo,
  placeholder,
  className,
}: PlaceAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<PhotonFeature[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Vrai juste après une sélection — évite de rouvrir le dropdown sur le
  // onChange déclenché par la sélection elle-même
  const justSelectedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Position ANCRÉE du menu, en coordonnées viewport. Le menu est rendu dans un
  // portal (voir plus bas) : il ne peut donc plus se positionner tout seul par
  // rapport à l'input, on la calcule ici.
  const [anchor, setAnchor] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      // Le menu vit dans un portal : il n'est plus un descendant du conteneur,
      // il faut donc l'exclure explicitement, sinon cliquer une suggestion
      // fermait la liste avant que le clic n'aboutisse.
      if (containerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  // Recalcule l'ancrage du menu tant qu'il est ouvert : à l'ouverture, puis au
  // défilement (capture : n'importe quel conteneur défilant compte) et au
  // redimensionnement — sinon le menu resterait figé pendant que l'input bouge.
  useEffect(() => {
    if (!open) { setAnchor(null); return; }
    const place = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dessous = window.innerHeight - r.bottom;
      // Pas la place en dessous (clavier mobile ouvert…) → on affiche au-dessus.
      // On ancre alors par le BAS, pour que le menu reste collé à l'input quelle
      // que soit sa hauteur réelle (sinon un menu court laisse un écart).
      const versLeHaut = dessous < 160 && r.top > dessous;
      setAnchor(
        versLeHaut
          ? { bottom: window.innerHeight - r.top + 4, left: r.left, width: r.width }
          : { top: r.bottom + 4, left: r.left, width: r.width },
      );
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, suggestions.length]);

  const search = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=fr`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const data = await res.json();
        const features = (data.features ?? []) as PhotonFeature[];
        setSuggestions(features);
        setOpen(features.length > 0);
        setHighlighted(-1);
      } catch {
        // abort ou réseau — silencieux, la saisie libre reste possible
      }
    }, 300);
  };

  const select = (f: PhotonFeature) => {
    const { name, detail } = featureLabel(f);
    const [lon, lat] = f.geometry.coordinates;
    justSelectedRef.current = true;
    onChange(name);
    onSelectGeo?.({ latitude: lat, longitude: lon, address: detail ? `${name}, ${detail}` : name });
    setOpen(false);
    setSuggestions([]);
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (justSelectedRef.current) {
            justSelectedRef.current = false;
            return;
          }
          // Toute modification manuelle invalide la geo précédemment sélectionnée
          onSelectGeo?.(null);
          search(e.target.value);
        }}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, -1));
          } else if (e.key === "Enter" && highlighted >= 0) {
            e.preventDefault();
            select(suggestions[highlighted]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        autoComplete="off"
        spellCheck={false}
      />

      {/* Menu rendu dans un PORTAL sur <body>, en position fixe ancrée à l'input.
          En `absolute` dans le flux, il était ROGNÉ par le premier ancêtre à
          `overflow-hidden` — typiquement la couverture arrondie de la visite,
          où la liste se retrouvait coupée net (retour utilisateur 2026-08-05).
          Un z-index n'y peut rien : on n'échappe pas à un clip par empilement. */}
      {open && suggestions.length > 0 && anchor && typeof document !== "undefined" && createPortal(
        <div
          ref={listRef}
          style={{ position: "fixed", top: anchor.top, bottom: anchor.bottom, left: anchor.left, width: anchor.width }}
          className="z-[90] rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl overflow-hidden max-h-56 overflow-y-auto">
          {suggestions.map((f, i) => {
            const { name, detail } = featureLabel(f);
            return (
              <button
                key={i}
                type="button"
                onClick={() => select(f)}
                className={`w-full text-left px-3 py-2 transition-colors ${
                  i === highlighted ? "bg-[var(--bg-surface)]" : "hover:bg-[var(--bg-surface)]"
                }`}
              >
                <p className="text-[11px] text-[var(--text-primary)] truncate">{name}</p>
                {detail && (
                  <p className="text-[9px] text-[var(--text-tertiary)] truncate">{detail}</p>
                )}
              </button>
            );
          })}
          <p className="px-3 py-1 text-[8px] text-[var(--text-tertiary)] border-t border-[var(--border-subtle)]">
            © OpenStreetMap
          </p>
        </div>,
        document.body
      )}
    </div>
  );
}
