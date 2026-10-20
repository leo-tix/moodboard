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

type Phase = "idle" | "trimming" | "uploading" | "converting" | "error";

// Au-delà de ce poids, ça vaut le coup de recadrer EN LOCAL avant d'envoyer
// (retour utilisateur 2026-10-16 : "n'envoyer sur le serveur que le segment
// à convertir", pour que ce soit plus rapide). En dessous, l'aller-retour
// réseau est déjà rapide et l'attente d'enregistrement (temps réel, borné
// à la durée du passage) coûterait plus qu'elle ne ferait gagner.
const CLIENT_TRIM_MIN_SIZE = 20 * 1024 * 1024;

// Recadre la vidéo DANS LE NAVIGATEUR : on relit le passage [start, end] en
// capturant le flux vidéo de l'élément (captureStream) dans un
// MediaRecorder, qui produit un petit fichier WebM ne contenant QUE le
// segment voulu — c'est lui qui part ensuite au serveur, pas la vidéo
// entière. Coûte un temps réel égal à la durée du passage (ça "joue" la
// vidéo pour la capturer), mais ce temps est borné (15s max) et largement
// compensé par un envoi réseau bien plus léger sur une grosse vidéo source.
// `null` = API indisponible ou échec → l'appelant retombe sur l'envoi du
// fichier original (le serveur fait alors le recadrage lui-même, comme
// avant).
// `captureStream` est un standard récent, pas encore dans lib.dom.d.ts de
// TypeScript sur toutes les versions — présent à l'exécution sur les
// navigateurs qui le supportent, absent sinon (d'où le typeof plus bas).
interface VideoElementWithCapture extends HTMLVideoElement {
  captureStream?: () => MediaStream;
}

async function recordSegmentClientSide(
  video: HTMLVideoElement,
  start: number,
  end: number,
  onProgress: (pct: number) => void,
): Promise<Blob | null> {
  const captureEl = video as VideoElementWithCapture;
  if (typeof MediaRecorder === "undefined" || typeof captureEl.captureStream !== "function") return null;
  let stream: MediaStream;
  try {
    stream = captureEl.captureStream();
  } catch {
    return null;
  }
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return null;

  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
    .find((t) => MediaRecorder.isTypeSupported?.(t));
  if (!mimeType) return null;

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(new MediaStream([videoTrack]), { mimeType });
  } catch {
    return null;
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = (e) => reject(e);
  });

  video.pause();
  if (Math.abs(video.currentTime - start) > 0.05) {
    await new Promise<void>((resolve) => {
      const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
      video.addEventListener("seeked", onSeeked);
      video.currentTime = start;
    });
  }

  recorder.start();
  try {
    await video.play();
  } catch {
    recorder.stop();
    return null;
  }

  await new Promise<void>((resolve) => {
    const tick = () => {
      if (video.currentTime >= end || video.ended) { resolve(); return; }
      onProgress(Math.max(0, Math.min(100, Math.round(((video.currentTime - start) / (end - start)) * 100))));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  video.pause();
  recorder.stop();
  return stopped;
}

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

// Format mm:ss.s <-> secondes, pour les champs de saisie précise (retour
// utilisateur 2026-10-16 : poignées peu précises sur vidéo longue).
function formatMmSs(totalSeconds: number): string {
  const t = Math.max(0, totalSeconds);
  const mins = Math.floor(t / 60);
  const secs = t - mins * 60;
  return `${mins}:${secs.toFixed(1).padStart(4, "0")}`;
}

function parseMmSs(text: string): number | null {
  const m = text.trim().match(/^(\d+):([0-5]?\d(?:\.\d+)?)$/);
  if (!m) return null;
  const mins = Number(m[1]);
  const secs = Number(m[2]);
  if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null;
  return mins * 60 + secs;
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
  const [reviewing, setReviewing] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [startText, setStartText] = useState("0:00.0");
  const [endText, setEndText] = useState("0:00.0");
  const startFocused = useRef(false);
  const endFocused = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [maxDurationS, setMaxDurationS] = useState(15);
  const [maxUploadBytes, setMaxUploadBytes] = useState(150 * 1024 * 1024);
  const busy = phase === "trimming" || phase === "uploading" || phase === "converting";

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
    setCurrentTime(0);
  };

  // Boucle de prévisualisation : lecture confinée à [start, end], pilotée en
  // requestAnimationFrame plutôt que `timeupdate` — cet évènement est
  // throttlé par le navigateur (parfois 250ms+ entre deux déclenchements),
  // ce qui laissait la lecture dépasser visiblement le point de fin avant
  // le rebouclage (retour utilisateur 2026-10-16). rAF tourne à la cadence
  // d'affichage, donc le dépassement est borné à une frame.
  // Suspendue pendant un "Revoir le passage" (cf. plus bas), qui gère sa
  // propre boucle déterministe non répétée.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing || reviewing) return;
    let raf = 0;
    const tick = () => {
      if (v.currentTime >= end) v.currentTime = start;
      setCurrentTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, start, end, reviewing]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (reviewing) setReviewing(false);
    if (playing) { v.pause(); setPlaying(false); return; }
    if (v.currentTime < start || v.currentTime >= end) v.currentTime = start;
    v.play();
    setPlaying(true);
  };

  // Rejoue une fois, de façon déterministe, exactement [start, end] —
  // indépendant de la boucle automatique ci-dessus (retour utilisateur
  // 2026-10-16 : aucun moyen de revoir le passage sans relancer la lecture
  // manuellement).
  const reviewSegment = () => {
    const v = videoRef.current;
    if (!v || busy) return;
    setPlaying(false);
    v.pause();
    setReviewing(true);
    const onSeeked = () => {
      v.removeEventListener("seeked", onSeeked);
      v.play().catch(() => setReviewing(false));
    };
    v.addEventListener("seeked", onSeeked);
    v.currentTime = start;
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !reviewing) return;
    let raf = 0;
    const tick = () => {
      if (v.currentTime >= end || v.ended) {
        v.pause();
        v.currentTime = end;
        setCurrentTime(end);
        setReviewing(false);
        return;
      }
      setCurrentTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reviewing, end]);

  // En déplaçant une poignée (ou la tête de lecture), on affiche la frame
  // correspondante — sans ça la vidéo reste figée sur une frame quelconque
  // pendant le réglage, sans indice visuel de "où" on se trouve (retour
  // utilisateur 2026-10-16).
  const seekPreview = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); }
    if (reviewing) setReviewing(false);
    v.currentTime = t;
    setCurrentTime(t);
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

  // Champs numériques mm:ss.s — synchronisés bidirectionnellement avec les
  // poignées : ils reflètent start/end tant que l'utilisateur n'est pas en
  // train d'y taper (sinon on écraserait sa saisie en cours).
  useEffect(() => { if (!startFocused.current) setStartText(formatMmSs(start)); }, [start]);
  useEffect(() => { if (!endFocused.current) setEndText(formatMmSs(end)); }, [end]);

  const commitStartText = () => {
    const parsed = parseMmSs(startText);
    if (parsed !== null) onChangeStart(parsed);
    else setStartText(formatMmSs(start));
  };
  const commitEndText = () => {
    const parsed = parseMmSs(endText);
    if (parsed !== null) onChangeEnd(parsed);
    else setEndText(formatMmSs(end));
  };

  const confirm = async () => {
    setError(null);
    try {
      const ticketRes = await fetch("/api/gif/ticket");
      const ticket = (await ticketRes.json()) as Ticket & { error?: string };
      if (!ticketRes.ok || !ticket.url || !ticket.token) {
        throw new Error(ticket.error || "Service de conversion indisponible.");
      }

      let uploadFile: File = file;
      let uploadStart = start;
      let uploadEnd = end;

      if (file.size > CLIENT_TRIM_MIN_SIZE && videoRef.current) {
        setPhase("trimming");
        setUploadPct(0);
        const segment = await recordSegmentClientSide(videoRef.current, start, end, setUploadPct).catch(() => null);
        if (segment && segment.size > 0) {
          uploadFile = new File([segment], "segment.webm", { type: segment.type || "video/webm" });
          // Petite marge : le minutage de l'enregistrement n'est pas à la
          // milliseconde près, et le serveur retaille de toute façon.
          uploadStart = 0;
          uploadEnd = end - start + 0.5;
        }
        // Si l'enregistrement a échoué (API indisponible, navigateur trop
        // ancien…), uploadFile reste le fichier original — repli silencieux
        // sur le comportement précédent (le serveur recadre lui-même).
      }

      if (uploadFile.size > ticket.maxUploadBytes) {
        throw new Error(`Vidéo trop lourde (max ${fmtSize(ticket.maxUploadBytes)}).`);
      }

      setPhase("uploading");
      setUploadPct(0);
      const blob = await uploadWithProgress(
        ticket, uploadFile, uploadStart, uploadEnd,
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
  const headPct = duration > 0 ? (currentTime / duration) * 100 : 0;

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
          {phase === "trimming"
            ? `Préparation… ${uploadPct}%`
            : phase === "uploading"
              ? `Envoi… ${uploadPct}%`
              : phase === "converting"
                ? "Conversion…"
                : "Convertir"}
        </button>
      </div>

      {/* Barre de progression — envoi chiffré (octets réellement transmis),
          puis indéterminée pendant la conversion ffmpeg côté serveur (aucun
          octet ne transite à ce moment, pas de pourcentage honnête
          possible) — retour utilisateur 2026-10-16, "on ne sait pas où ça
          en est". */}
      {busy && (
        <div className="flex-shrink-0 h-1 bg-white/10 overflow-hidden">
          {phase === "trimming" || phase === "uploading" ? (
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
              disabled={busy}
              className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors disabled:pointer-events-none"
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
          {/* Piste/poignées entièrement custom (divs décoratives) — les trois
              <input type=range> réels (début, fin, tête de lecture) restent
              superposés par-dessus mais INVISIBLES (opacity:0), avec le
              toucher limité à leur seule poignée native (CSS plus bas).
              Rendre fiable ET lisible : avant ce changement, les pistes
              natives des deux curseurs se chevauchaient visuellement (rendu
              confus — retour utilisateur 2026-10-16). La tête de lecture
              (losange ambre) a un z-index inférieur aux poignées de trim :
              en cas de chevauchement pixel-exact, le trim reste prioritaire
              au toucher. */}
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
            <div
              className="absolute top-1/2 w-2.5 h-2.5 bg-amber-400 shadow-[0_0_0_1px_rgba(0,0,0,0.4)] pointer-events-none"
              style={{ left: `${headPct}%`, transform: "translate(-50%, -50%) rotate(45deg)" }}
            />
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={currentTime}
              onChange={(e) => seekPreview(Number(e.target.value))}
              disabled={busy}
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full opacity-0 playhead-range"
              style={{ zIndex: 1 }}
              aria-label="Tête de lecture (navigation libre)"
            />
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={start}
              onChange={(e) => onChangeStart(Number(e.target.value))}
              disabled={busy}
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
              disabled={busy}
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full opacity-0"
              style={{ zIndex: 3 }}
              aria-label="Fin du passage"
            />
          </div>

          {/* Saisie précise mm:ss.s + ajustement fin — synchronisés avec les
              poignées ci-dessus (retour utilisateur 2026-10-16 : poignées
              peu précises sur vidéo longue). */}
          <div className="flex items-center justify-between gap-2 mt-3">
            <div className="flex items-center gap-1">
              <button type="button" disabled={busy} onClick={() => onChangeStart(start - 1)} className="w-6 h-6 rounded-full bg-white/10 text-white/80 text-[10px] disabled:opacity-40">-1</button>
              <button type="button" disabled={busy} onClick={() => onChangeStart(start - 0.1)} className="w-6 h-6 rounded-full bg-white/10 text-white/80 text-[10px] disabled:opacity-40">-.1</button>
              <input
                type="text"
                inputMode="decimal"
                value={startText}
                onChange={(e) => setStartText(e.target.value)}
                onFocus={() => { startFocused.current = true; }}
                onBlur={() => { startFocused.current = false; commitStartText(); }}
                onKeyDown={(e) => { if (e.key === "Enter") { commitStartText(); (e.target as HTMLInputElement).blur(); } }}
                disabled={busy}
                className="w-16 text-center text-[11px] tabular-nums bg-white/10 rounded-md py-1 text-white outline-none focus:bg-white/20 disabled:opacity-40"
                aria-label="Début précis (mm:ss.s)"
              />
              <button type="button" disabled={busy} onClick={() => onChangeStart(start + 0.1)} className="w-6 h-6 rounded-full bg-white/10 text-white/80 text-[10px] disabled:opacity-40">+.1</button>
              <button type="button" disabled={busy} onClick={() => onChangeStart(start + 1)} className="w-6 h-6 rounded-full bg-white/10 text-white/80 text-[10px] disabled:opacity-40">+1</button>
            </div>

            <button
              type="button"
              onClick={reviewSegment}
              disabled={busy || reviewing}
              className="flex-shrink-0 px-2.5 py-1 rounded-full bg-white/10 text-white/80 text-[11px] disabled:opacity-40 hover:bg-white/20 transition-colors"
            >
              Revoir le passage
            </button>

            <div className="flex items-center gap-1">
              <button type="button" disabled={busy} onClick={() => onChangeEnd(end - 1)} className="w-6 h-6 rounded-full bg-white/10 text-white/80 text-[10px] disabled:opacity-40">-1</button>
              <button type="button" disabled={busy} onClick={() => onChangeEnd(end - 0.1)} className="w-6 h-6 rounded-full bg-white/10 text-white/80 text-[10px] disabled:opacity-40">-.1</button>
              <input
                type="text"
                inputMode="decimal"
                value={endText}
                onChange={(e) => setEndText(e.target.value)}
                onFocus={() => { endFocused.current = true; }}
                onBlur={() => { endFocused.current = false; commitEndText(); }}
                onKeyDown={(e) => { if (e.key === "Enter") { commitEndText(); (e.target as HTMLInputElement).blur(); } }}
                disabled={busy}
                className="w-16 text-center text-[11px] tabular-nums bg-white/10 rounded-md py-1 text-white outline-none focus:bg-white/20 disabled:opacity-40"
                aria-label="Fin précise (mm:ss.s)"
              />
              <button type="button" disabled={busy} onClick={() => onChangeEnd(end + 0.1)} className="w-6 h-6 rounded-full bg-white/10 text-white/80 text-[10px] disabled:opacity-40">+.1</button>
              <button type="button" disabled={busy} onClick={() => onChangeEnd(end + 1)} className="w-6 h-6 rounded-full bg-white/10 text-white/80 text-[10px] disabled:opacity-40">+1</button>
            </div>
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
        .dual-range input.playhead-range::-webkit-slider-thumb {
          width: 16px;
          height: 28px;
        }
        .dual-range input.playhead-range::-moz-range-thumb {
          width: 16px;
          height: 28px;
        }
      `}</style>

      {error && (
        <p className="flex-shrink-0 text-center text-[11px] text-red-400 pb-2 px-4">{error}</p>
      )}
      <p className="flex-shrink-0 text-center text-[11px] text-white/60 pb-[calc(1rem+env(safe-area-inset-bottom))] px-4">
        {phase === "trimming"
          ? "Préparation du passage sur l'appareil — pour n'envoyer que le segment, pas toute la vidéo…"
          : phase === "converting"
            ? "Conversion en cours sur le serveur — ça peut prendre quelques secondes…"
            : `Ajuste le début et la fin, puis « Convertir » — ${maxDurationS}s maximum, vidéo jusqu'à ${fmtSize(maxUploadBytes)}.`}
      </p>
    </div>,
    document.body,
  );
}
