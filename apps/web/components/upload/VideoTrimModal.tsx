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

type Phase = "idle" | "uploading" | "converting" | "error";

// Upload direct au worker VPS avec suivi de PROGRESSION RÉELLE (XHR, pas
// fetch — fetch n'expose pas d'événement de progression d'upload). Au-delà
// de 100% d'envoi, plus aucun octet ne transite : la conversion ffmpeg
// tourne côté serveur sans retour chiffrable, d'où la phase "converting"
// (indéterminée) plutôt qu'un pourcentage inventé.
function uploadWithProgress(
  ticket: Ticket,
  file: File,
  start: number,
  end: number,
  onProgress: (pct: number) => void,
  onUploaded: () => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("start", String(start));
    fd.append("end", String(end));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", ticket.url);
    xhr.setRequestHeader("Authorization", `Bearer ${ticket.token}`);
    xhr.responseType = "blob";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.upload.onload = () => { onProgress(100); onUploaded(); };
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as Blob);
        return;
      }
      let message = "Échec de la conversion.";
      try {
        const body = JSON.parse(await (xhr.response as Blob).text());
        if (body.error === "too_long") message = `Intervalle trop long (max ${ticket.maxDurationS}s).`;
        else if (body.error) message = body.error;
      } catch { /* corps non-JSON — message générique */ }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Erreur réseau."));
    xhr.send(fd);
  });
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
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [maxDurationS, setMaxDurationS] = useState(15);
  const [maxUploadBytes, setMaxUploadBytes] = useState(150 * 1024 * 1024);
  const busy = phase === "uploading" || phase === "converting";

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
      .then((t: Partial<Ticket>) => {
        if (t.maxDurationS) setMaxDurationS(t.maxDurationS);
        if (t.maxUploadBytes) setMaxUploadBytes(t.maxUploadBytes);
      })
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

  // En déplaçant une poignée, on affiche la frame correspondante — sans ça
  // la vidéo reste figée sur une frame quelconque pendant le réglage, sans
  // indice visuel de "où" on se trouve (retour utilisateur 2026-10-16).
  const seekPreview = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); }
    v.currentTime = t;
  };

  const onChangeStart = useCallback((val: number) => {
    const next = Math.min(val, end - 0.2);
    setStart(next);
    seekPreview(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end]);

  const onChangeEnd = useCallback((val: number) => {
    const maxEnd = Math.min(duration, start + maxDurationS);
    const next = Math.max(val, start + 0.2) > maxEnd ? maxEnd : Math.max(val, start + 0.2);
    setEnd(next);
    seekPreview(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, duration, maxDurationS]);

  const confirm = async () => {
    setPhase("uploading");
    setUploadPct(0);
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

      const blob = await uploadWithProgress(
        ticket, file, start, end,
        setUploadPct,
        () => setPhase("converting"),
      );
      const gifFile = new File([blob], file.name.replace(/\.[^.]+$/, "") + ".gif", { type: "image/gif" });
      onConverted(gifFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau.");
      setPhase("error");
    }
  };

  const fmt = (s: number) => `${s.toFixed(1)}s`;
  const fmtSize = (bytes: number) =>
    bytes >= 1024 * 1024 * 1024
      ? `${Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10} Go`
      : `${Math.round(bytes / 1024 / 1024)} Mo`;
  const startPct = duration > 0 ? (start / duration) * 100 : 0;
  const endPct = duration > 0 ? (end / duration) * 100 : 0;

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
          {phase === "uploading" ? `Envoi… ${uploadPct}%` : phase === "converting" ? "Conversion…" : "Convertir"}
        </button>
      </div>

      {/* Barre de progression — envoi chiffré (octets réellement transmis),
          puis indéterminée pendant la conversion ffmpeg côté serveur (aucun
          octet ne transite à ce moment, pas de pourcentage honnête
          possible) — retour utilisateur 2026-10-16, "on ne sait pas où ça
          en est". */}
      {busy && (
        <div className="flex-shrink-0 h-1 bg-white/10 overflow-hidden">
          {phase === "uploading" ? (
            <div className="h-full bg-white transition-[width] duration-150" style={{ width: `${uploadPct}%` }} />
          ) : (
            <div className="h-full w-1/3 bg-white animate-[indeterminate_1.2s_ease-in-out_infinite]" />
          )}
        </div>
      )}
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
          <div className="flex justify-between text-[11px] text-white/60 mb-2.5 tabular-nums">
            <span>Début {fmt(start)}</span>
            <span>{(end - start).toFixed(1)}s / {maxDurationS}s max</span>
            <span>Fin {fmt(end)}</span>
          </div>
          {/* Piste/poignées entièrement custom (divs décoratives) — les deux
              <input type=range> réels restent superposés par-dessus mais
              INVISIBLES (opacity:0), avec le toucher limité à leur seule
              poignée native (CSS plus bas). Rendre fiable ET lisible : avant
              ce changement, les pistes natives des deux curseurs se
              chevauchaient visuellement (rendu confus — retour utilisateur
              2026-10-16). */}
          <div className="relative h-8 dual-range">
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/15 pointer-events-none" />
            <div
              className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-white pointer-events-none"
              style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
            />
            <div
              className="absolute top-1/2 w-4 h-4 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)] pointer-events-none"
              style={{ left: `${startPct}%`, transform: "translate(-50%, -50%)" }}
            />
            <div
              className="absolute top-1/2 w-4 h-4 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)] pointer-events-none"
              style={{ left: `${endPct}%`, transform: "translate(-50%, -50%)" }}
            />
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={start}
              onChange={(e) => onChangeStart(Number(e.target.value))}
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full opacity-0"
              style={{ zIndex: start > end - (duration * 0.05) ? 4 : 2 }}
              aria-label="Début du passage"
            />
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={end}
              onChange={(e) => onChangeEnd(Number(e.target.value))}
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full opacity-0"
              style={{ zIndex: 3 }}
              aria-label="Fin du passage"
            />
          </div>
        </div>
      )}
      {/* Balise <style> ordinaire (pas styled-jsx — deux <style jsx> dans le
          même composant, l'un global pour @keyframes et l'autre scopé pour
          .dual-range, déclenchaient "nested styled-jsx tag" au build). Les
          sélecteurs sont assez spécifiques (.dual-range, @keyframes
          indeterminate) pour ne rien heurter ailleurs dans l'app. */}
      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        .dual-range input[type="range"] {
          pointer-events: none;
        }
        .dual-range input[type="range"]::-webkit-slider-thumb {
          pointer-events: auto;
          width: 28px;
          height: 28px;
        }
        .dual-range input[type="range"]::-moz-range-thumb {
          pointer-events: auto;
          width: 28px;
          height: 28px;
          border: none;
        }
      `}</style>

      {error && (
        <p className="flex-shrink-0 text-center text-[11px] text-red-400 pb-2 px-4">{error}</p>
      )}
      <p className="flex-shrink-0 text-center text-[11px] text-white/60 pb-[calc(1rem+env(safe-area-inset-bottom))] px-4">
        {phase === "converting"
          ? "Conversion en cours sur le serveur — ça peut prendre quelques secondes…"
          : `Ajuste le début et la fin, puis « Convertir » — ${maxDurationS}s maximum, vidéo jusqu'à ${fmtSize(maxUploadBytes)}.`}
      </p>
    </div>,
    document.body,
  );
}
