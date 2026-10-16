"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Film, Loader2, Play, Pause } from "lucide-react";

// Upload vidéo → GIF (retour utilisateur 2026-10-16) : trim in/out puis
// conversion sur le petit service dédié du VPS (apps/gif-worker), appelé
// DIRECTEMENT depuis le navigateur — pas via une fonction Vercel, dont le
// corps de requête est plafonné à quelques Mo, bien en-dessous du poids
// d'une vidéo. Le navigateur n'a jamais le secret du service : il récupère
// un ticket signé à courte durée de vie (/api/gif/ticket, exige une
// session) juste avant l'envoi. Le GIF obtenu est ensuite traité comme
// n'importe quel fichier importé (DropZone.addFiles → /api/upload/image).

interface Ticket {
  url: string;
  token: string;
  maxDurationS: number;
  maxUploadBytes: number;
}

export function VideoTrimModal({
  file,
  onCancel,
  onConverted,
}: {
  file: File;
  onCancel: () => void;
  /** GIF résultant, prêt à être traité comme un fichier importé classique. */
  onConverted: (gifFile: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxDurationS, setMaxDurationS] = useState(15);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Récupère les limites tôt (avant même la conversion) pour les refléter
  // dans les curseurs — évite de laisser l'utilisateur régler un intervalle
  // que le serveur refusera de toute façon.
  useEffect(() => {
    fetch("/api/gif/ticket")
      .then((r) => r.json())
      .then((t: Partial<Ticket>) => { if (t.maxDurationS) setMaxDurationS(t.maxDurationS); })
      .catch(() => {});
  }, []);

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    const d = v.duration || 0;
    setDuration(d);
    setStart(0);
    setEnd(Math.min(d, maxDurationS));
  };

  // Boucle de prévisualisation : lecture confinée à [start, end].
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing) return;
    const onTime = () => { if (v.currentTime >= end) v.currentTime = start; };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [playing, start, end]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); return; }
    if (v.currentTime < start || v.currentTime >= end) v.currentTime = start;
    v.play();
    setPlaying(true);
  };

  const onChangeStart = useCallback((val: number) => {
    setStart(Math.min(val, end - 0.2));
  }, [end]);

  const onChangeEnd = useCallback((val: number) => {
    const maxEnd = Math.min(duration, start + maxDurationS);
    setEnd(Math.max(val, start + 0.2) > maxEnd ? maxEnd : Math.max(val, start + 0.2));
  }, [start, duration, maxDurationS]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const ticketRes = await fetch("/api/gif/ticket");
      const ticket = (await ticketRes.json()) as Ticket & { error?: string };
      if (!ticketRes.ok || !ticket.url || !ticket.token) {
        throw new Error(ticket.error || "Service de conversion indisponible.");
      }
      if (file.size > ticket.maxUploadBytes) {
        throw new Error(`Vidéo trop lourde (max ${Math.round(ticket.maxUploadBytes / 1024 / 1024)} Mo).`);
      }

      const fd = new FormData();
      fd.append("file", file);
      fd.append("start", String(start));
      fd.append("end", String(end));

      const res = await fetch(ticket.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${ticket.token}` },
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error === "too_long" ? `Intervalle trop long (max ${maxDurationS}s).` : "Échec de la conversion.");
      }
      const blob = await res.blob();
      const gifFile = new File([blob], file.name.replace(/\.[^.]+$/, "") + ".gif", { type: "image/gif" });
      onConverted(gifFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau.");
      setBusy(false);
    }
  };

  const fmt = (s: number) => `${s.toFixed(1)}s`;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] bg-black/90 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0 gap-2">
        <button onClick={onCancel} disabled={busy} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 disabled:opacity-50 transition-colors flex-shrink-0" aria-label="Annuler">
          <X size={18} strokeWidth={2} />
        </button>
        <p className="text-sm font-medium text-white/90 truncate flex items-center gap-1.5"><Film size={14} strokeWidth={2} /> Vidéo → GIF</p>
        <button onClick={confirm} disabled={busy || duration === 0} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-black text-sm font-medium disabled:opacity-40 transition-opacity flex-shrink-0">
          {busy ? <Loader2 size={15} className="animate-spin" /> : null}
          {busy ? "Conversion…" : "Convertir"}
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden">
        <div className="relative inline-block max-w-full max-h-[60vh]">
          {url && (
            <video
              ref={videoRef}
              src={url}
              onLoadedMetadata={onLoadedMetadata}
              onPause={() => setPlaying(false)}
              playsInline
              muted
              className="block max-w-full max-h-[60vh]"
            />
          )}
          {duration > 0 && (
            <button
              onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors"
              aria-label={playing ? "Pause" : "Lecture"}
            >
              {!playing && (
                <span className="w-14 h-14 rounded-full bg-black/60 flex items-center justify-center">
                  <Play size={22} className="text-white ml-0.5" />
                </span>
              )}
              {playing && (
                <span className="w-14 h-14 rounded-full bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                  <Pause size={22} className="text-white" />
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {duration > 0 && (
        <div className="flex-shrink-0 px-5 pb-2">
          <div className="flex justify-between text-[11px] text-white/60 mb-1.5 tabular-nums">
            <span>Début {fmt(start)}</span>
            <span>{(end - start).toFixed(1)}s / {maxDurationS}s max</span>
            <span>Fin {fmt(end)}</span>
          </div>
          {/* Deux curseurs natifs superposés — fiables au toucher (pas de
              geste maison à reproduire), contrairement à un cadre custom. */}
          <div className="relative h-8">
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={start}
              onChange={(e) => onChangeStart(Number(e.target.value))}
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full accent-white"
              style={{ zIndex: 2 }}
            />
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={end}
              onChange={(e) => onChangeEnd(Number(e.target.value))}
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full accent-white"
              style={{ zIndex: 3 }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="flex-shrink-0 text-center text-[11px] text-red-400 pb-2 px-4">{error}</p>
      )}
      <p className="flex-shrink-0 text-center text-[11px] text-white/60 pb-[calc(1rem+env(safe-area-inset-bottom))] px-4">
        Ajuste le début et la fin, puis « Convertir » — {maxDurationS}s maximum.
      </p>
    </div>,
    document.body,
  );
}
