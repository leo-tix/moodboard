"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { RangeScrubber } from "./RangeScrubber";

// Sous-flux YouTube dédié (#7) : contrairement à TikTok/Instagram (vidéos
// déjà courtes, cf. VideoLinkImportClient), une vidéo YouTube peut être
// longue — télécharger la vidéo entière pour n'en garder que quelques
// secondes gaspillerait la bande passante du VPS partagé. Ce composant
// laisse choisir la plage à extraire AVANT tout téléchargement (lecteur
// YouTube officiel embarqué pour scruber + champs mm:ss.s pour affiner),
// puis ne télécharge QUE cette section (/api/video-link/section-ticket →
// apps/gif-worker /fetch-url-section, yt-dlp --download-sections). Le
// résultat est ensuite traité exactement comme le flux TikTok/Instagram :
// passé à VideoTrimModal pour l'affinage final.

interface SectionTicket {
  url: string;
  token: string;
  platform: "youtube";
  sourceLabel: string;
  sourceUrl: string;
  title: string | null;
  start: number;
  end: number;
  durationS: number;
  maxSectionDurationS: number;
  isAdmin: boolean;
}

export interface YouTubeSectionResult {
  file: File;
  sourceLabel: string;
  sourceUrl: string;
}

// ─── Minimal typings for the official IFrame Player API (injected globally,
// pas de @types dédié dans le repo — on ne type que ce qu'on utilise). ────
interface YTPlayer {
  getDuration(): number;
  getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement | string,
    opts: {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: { onReady?: (e: { target: YTPlayer }) => void };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoadPromise: Promise<void> | null = null;
function loadYouTubeIframeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;
  apiLoadPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  });
  return apiLoadPromise;
}

// Lien avec timecode (?t= ou &t=) — formats acceptés : secondes nues
// ("90") ou notation YouTube "1h2m3s" / "2m30s" / "45s".
export function parseYouTubeTimecode(rawUrl: string): number | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const t = u.searchParams.get("t") ?? u.searchParams.get("start");
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  return h * 3600 + min * 60 + s;
}

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

const DEFAULT_WINDOW_S = 5;

export function YouTubeSectionPicker({
  url,
  videoId,
  onDownloaded,
  onError,
}: {
  url: string;
  videoId: string;
  onDownloaded: (result: YouTubeSectionResult) => void;
  onError: (error: string, detail: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const containerId = `yt-section-player-${useId().replace(/:/g, "")}`;

  const [playerReady, setPlayerReady] = useState(false);
  const [playerFailed, setPlayerFailed] = useState(false);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(DEFAULT_WINDOW_S);
  const [startText, setStartText] = useState(formatMmSs(0));
  const [endText, setEndText] = useState(formatMmSs(DEFAULT_WINDOW_S));
  const startFocused = useRef(false);
  const endFocused = useRef(false);
  const [downloading, setDownloading] = useState(false);
  const [maxSectionDurationS, setMaxSectionDurationS] = useState(90);

  // Charge l'API IFrame officielle (une seule fois par page) puis instancie
  // le lecteur. En cas d'échec (script bloqué, réseau…), on retombe sur les
  // seuls champs numériques — pas de scrub, mais la section reste
  // sélectionnable.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeIframeApi()
      .then(() => {
        if (cancelled || !containerRef.current || !window.YT) return;
        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId,
          playerVars: { modestbranding: 1, rel: 0 },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              const d = e.target.getDuration() || 0;
              setDuration(d);
              setPlayerReady(true);

              // Préremplissage depuis ?t=/&t= — plage de 5s à partir du
              // timecode (critère d'acceptation #7), clampée à la durée
              // réelle une fois connue.
              const t = parseYouTubeTimecode(url);
              if (t !== null && t >= 0) {
                const clampedStart = d > 0 ? Math.min(t, Math.max(0, d - 0.5)) : t;
                const clampedEnd = d > 0 ? Math.min(d, clampedStart + DEFAULT_WINDOW_S) : clampedStart + DEFAULT_WINDOW_S;
                setStart(clampedStart);
                setEnd(clampedEnd);
                setStartText(formatMmSs(clampedStart));
                setEndText(formatMmSs(clampedEnd));
              } else if (d > 0) {
                setEnd(Math.min(d, DEFAULT_WINDOW_S));
                setEndText(formatMmSs(Math.min(d, DEFAULT_WINDOW_S)));
              }
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setPlayerFailed(true);
      });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useEffect(() => {
    if (!startFocused.current) setStartText(formatMmSs(start));
  }, [start]);
  useEffect(() => {
    if (!endFocused.current) setEndText(formatMmSs(end));
  }, [end]);

  const seekTo = (t: number) => {
    playerRef.current?.seekTo(t, true);
  };

  const setStartHere = () => {
    const t = playerRef.current?.getCurrentTime() ?? 0;
    const next = Math.min(t, end - 0.2);
    setStart(Math.max(0, next));
  };
  const setEndHere = () => {
    const t = playerRef.current?.getCurrentTime() ?? 0;
    const maxEnd = duration > 0 ? duration : t + maxSectionDurationS;
    const minEnd = start + 0.2;
    setEnd(Math.max(minEnd, Math.min(t, maxEnd)));
  };

  const commitStartText = () => {
    const parsed = parseMmSs(startText);
    if (parsed !== null) {
      const next = Math.min(Math.max(0, parsed), end - 0.2);
      setStart(next);
      seekTo(next);
    } else {
      setStartText(formatMmSs(start));
    }
  };
  const commitEndText = () => {
    const parsed = parseMmSs(endText);
    if (parsed !== null) {
      const maxEnd = duration > 0 ? duration : parsed;
      const next = Math.max(start + 0.2, Math.min(parsed, maxEnd));
      setEnd(next);
      seekTo(next);
    } else {
      setEndText(formatMmSs(end));
    }
  };

  const sectionLength = Math.max(0, end - start);
  const tooLong = sectionLength > maxSectionDurationS;

  const handleDownload = async () => {
    if (downloading || tooLong || sectionLength <= 0) return;
    setDownloading(true);
    try {
      const ticketRes = await fetch("/api/video-link/section-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, start, end }),
      });
      const ticket = (await ticketRes.json()) as Partial<SectionTicket> & { error?: string; detail?: string };
      if (!ticketRes.ok || !ticket.url || !ticket.token) {
        if (ticket.maxSectionDurationS) setMaxSectionDurationS(ticket.maxSectionDurationS);
        onError(ticket.error || "Import impossible.", ticket.detail ?? null);
        return;
      }

      // Le serveur a pu ajuster start/end (marge pour l'affinage ensuite,
      // cf. section-ticket/route.ts) — on utilise SA plage, pas la nôtre.
      const videoRes = await fetch(ticket.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${ticket.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, start: ticket.start, end: ticket.end }),
      });
      if (!videoRes.ok) {
        const errBody = (await videoRes.json().catch(() => ({}))) as { error?: string; message?: string };
        onError(
          "Téléchargement de la section échoué (lien privé, géo-bloqué, ou passage indisponible).",
          ticket.isAdmin ? errBody.message || errBody.error || null : null,
        );
        return;
      }

      const blob = await videoRes.blob();
      const file = new File([blob], "youtube-section.mp4", { type: blob.type || "video/mp4" });
      onDownloaded({ file, sourceLabel: ticket.sourceLabel!, sourceUrl: ticket.sourceUrl! });
    } catch {
      onError("Erreur réseau — vérifie ta connexion.", null);
    } finally {
      setDownloading(false);
    }
  };

  const fieldClass =
    "w-16 text-center text-[11px] tabular-nums bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-md py-1 text-[var(--text-primary)] outline-none focus:border-[var(--border-default)] disabled:opacity-40";

  return (
    <div className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: "16/9" }}>
        <div ref={containerRef} id={containerId} className="absolute inset-0 w-full h-full" />
        {!playerReady && !playerFailed && (
          <div className="absolute inset-0 flex items-center justify-center text-white/60">
            <Loader2 size={18} className="animate-spin" />
          </div>
        )}
        {playerFailed && (
          <div className="absolute inset-0 flex items-center justify-center text-center px-4 text-[11px] text-white/70">
            Lecteur indisponible — règle la plage avec les champs ci-dessous.
          </div>
        )}
      </div>

      <p className="text-[10px] text-[var(--text-tertiary)]">
        Glisse les poignées pour régler le début et la fin, ou le losange central pour déplacer tout le passage sans
        changer sa durée — ou touche la piste ailleurs pour la recentrer là ({sectionLength.toFixed(1)}s /{" "}
        {maxSectionDurationS}s max).
      </p>

      <RangeScrubber
        duration={duration}
        start={start}
        end={end}
        maxWindowS={maxSectionDurationS}
        onChange={(s, e) => { setStart(s); setEnd(e); }}
        onPreview={seekTo}
        disabled={!playerReady || downloading}
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={setStartHere}
            disabled={!playerReady || downloading}
            className="px-2.5 py-1 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] disabled:opacity-40 hover:border-[var(--border-default)] transition-colors"
          >
            Début ici
          </button>
          <input
            type="text"
            inputMode="decimal"
            value={startText}
            onChange={(e) => setStartText(e.target.value)}
            onFocus={() => { startFocused.current = true; }}
            onBlur={() => { startFocused.current = false; commitStartText(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { commitStartText(); (e.target as HTMLInputElement).blur(); } }}
            disabled={downloading}
            className={fieldClass}
            aria-label="Début précis (mm:ss.s)"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            inputMode="decimal"
            value={endText}
            onChange={(e) => setEndText(e.target.value)}
            onFocus={() => { endFocused.current = true; }}
            onBlur={() => { endFocused.current = false; commitEndText(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { commitEndText(); (e.target as HTMLInputElement).blur(); } }}
            disabled={downloading}
            className={fieldClass}
            aria-label="Fin précise (mm:ss.s)"
          />
          <button
            type="button"
            onClick={setEndHere}
            disabled={!playerReady || downloading}
            className="px-2.5 py-1 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] disabled:opacity-40 hover:border-[var(--border-default)] transition-colors"
          >
            Fin ici
          </button>
        </div>
      </div>

      {tooLong && (
        <p className="text-[10px] text-red-400">
          Passage trop long — réduis-le à {maxSectionDurationS}s maximum.
        </p>
      )}

      <button
        onClick={handleDownload}
        disabled={downloading || tooLong || sectionLength <= 0}
        className="w-full px-4 py-2.5 bg-[var(--text-primary)] text-[var(--bg-base)] text-sm rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
      >
        {downloading ? (
          <>
            <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-base)] border-t-transparent animate-spin" />
            Téléchargement de la section…
          </>
        ) : (
          "Télécharger cette section"
        )}
      </button>
    </div>
  );
}
