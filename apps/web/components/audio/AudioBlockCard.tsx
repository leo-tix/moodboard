"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Mic, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAudioUrl, getImageUrl } from "@/lib/storage/urls";
import { AudioMemoWaveform } from "@/components/audio/AudioMemoWaveform";
import { TranscriptKaraoke, type WordTiming } from "@/components/audio/TranscriptKaraoke";
import { AudioPlayerBoundary } from "@/components/visits/AudioPlayerBoundary";

const BAR_COUNT = 64;

export interface AudioBlockCardProps {
  storageKey: string;
  durationSec: number | null;
  transcript?: string | null;
  /** Timings par mot (Whisper) pour la surbrillance karaoke synchronisée. */
  wordTimings?: WordTiming[] | null;
  authorName?: string | null;
  authorImage?: string | null;
  className?: string;
  /** Carte contrainte à un format quasi carré (carnet de visite), plutôt que
      de remplir tout le conteneur (planches, dimensionnée par le canvas). */
  square?: boolean;
  /** Transcription éditable au clic (bloc audio du carnet) — masqué sur les
      planches, où le mémo est immuable une fois enregistré. */
  editable?: boolean;
  onPersistTranscript?: (text: string) => Promise<void>;
  /** Afficher la zone transcription/karaoké. `false` (petits formats du
      carnet) : avatar + waveform + lecture seulement, la waveform récupère
      toute la place — les mots qui défilent y seraient illisibles (demande
      utilisateur 2026-07-18). Défaut `true` (planches). */
  transcriptVisible?: boolean;
  /** Format compact (tuile 1 ligne) : paddings resserrés pour laisser voir la waveform. */
  dense?: boolean;
}

// Carte mémo vocal — dégradé sombre + fin contour, inspirée du "voice
// recorder widget" fourni en référence : waveform réactive, avatar de
// l'auteur, transcription "karaoke" qui se révèle mot par mot pendant la
// lecture, transport minimal. Réutilise le MÊME décodage de pics + la MÊME
// waveform (AudioMemoWaveform) et le MÊME TranscriptKaraoke partout où un
// mémo vocal est affiché — planches ET carnet de visite (demande
// utilisateur 2026-07-15 : "uniformiser"/"aligner le design").
function AudioBlockCardInner({
  storageKey,
  durationSec,
  transcript,
  wordTimings,
  authorName,
  authorImage,
  className,
  square = false,
  editable = false,
  onPersistTranscript,
  transcriptVisible = true,
  dense = false,
}: AudioBlockCardProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSec ?? 0);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(transcript ?? "");
  const src = getAudioUrl(storageKey);

  useEffect(() => {
    if (!editing) setValue(transcript ?? "");
  }, [transcript, editing]);

  // Décodage des pics d'amplitude — même logique/mêmes filets que
  // AudioPlayer.tsx (Safari ne décode pas toujours le webm/opus, le fetch
  // cross-origin peut traîner, iOS plafonne les AudioContext simultanés).
  useEffect(() => {
    let cancelled = false;
    const fallbackBars = () => {
      let seed = 0;
      for (let i = 0; i < src.length; i++) seed = (seed * 31 + src.charCodeAt(i)) >>> 0;
      return Array.from({ length: BAR_COUNT }, (_, i) => {
        seed = (seed * 1103515245 + 12345) >>> 0;
        const r = seed / 4294967295;
        const envelope = 0.35 + 0.5 * Math.sin((i / BAR_COUNT) * Math.PI);
        return Math.max(0.12, Math.min(1, envelope * (0.5 + r * 0.9)));
      });
    };
    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled) setPeaks((p) => p ?? fallbackBars());
    }, 5000);

    let ctx: AudioContext | null = null;
    (async () => {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new AC();
        const buf = await fetch(src).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.arrayBuffer();
        });
        const decoded = await ctx.decodeAudioData(buf);
        if (cancelled) return;
        const channel = decoded.getChannelData(0);
        const bucketSize = Math.max(1, Math.floor(channel.length / BAR_COUNT));
        const bars: number[] = [];
        for (let i = 0; i < BAR_COUNT; i++) {
          let max = 0;
          const start = i * bucketSize;
          for (let j = start; j < Math.min(start + bucketSize, channel.length); j++) {
            const v = Math.abs(channel[j]);
            if (v > max) max = v;
          }
          bars.push(max);
        }
        const peak = Math.max(...bars, 0.01);
        setPeaks(bars.map((b) => Math.max(0.08, b / peak)));
      } catch {
        if (!cancelled) setPeaks(fallbackBars());
      } finally {
        try { await ctx?.close(); } catch { /* déjà fermé */ }
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrentTime(el.currentTime);
    const onLoaded = () => setDuration(Number.isFinite(el.duration) ? el.duration : (durationSec ?? 0));
    const onEnded = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("ended", onEnded);
    };
  }, [durationSec]);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play(); setPlaying(true); }
  };

  const seekTo = (ratio: number) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    el.currentTime = Math.min(Math.max(0, ratio * duration), duration);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const progress = duration > 0 ? currentTime / duration : 0;

  const cleanTranscript = transcript?.trim() || null;
  // La zone transcription n'apparaît que si le format l'autorise
  // (transcriptVisible) ET qu'il y a de quoi l'afficher (édition ou texte
  // existant). Sinon la waveform récupère toute la place.
  const showTranscriptSlot = transcriptVisible && (editable || cleanTranscript);

  const commitEdit = () => {
    setEditing(false);
    if (value.trim() !== (transcript ?? "").trim()) onPersistTranscript?.(value).catch(() => {});
  };

  return (
    <div
      className={cn(
        "rounded-[20px] bg-gradient-to-b from-[#17171b] to-[#0c0c0e] border border-white/[0.08] shadow-2xl shadow-black/40 flex flex-col overflow-hidden select-none",
        square ? "w-full max-w-[300px] aspect-square" : "w-full h-full",
        className
      )}
    >
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      {/* Auteur — avatar + nom, éventuellement un accès édition */}
      <div className={cn("flex items-center gap-2 px-4 flex-shrink-0", dense ? "pt-2.5 pb-0.5" : "pt-4 pb-1")}>
        <div className="w-6 h-6 rounded-full overflow-hidden bg-white/10 flex-shrink-0 ring-1 ring-white/10 flex items-center justify-center">
          {authorImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getImageUrl(authorImage)} alt="" className="w-full h-full object-cover" draggable={false} />
          ) : authorName ? (
            <span className="text-[10px] text-white/70 font-medium">{authorName[0]?.toUpperCase()}</span>
          ) : (
            <Mic size={11} strokeWidth={1.75} className="text-white/50" />
          )}
        </div>
        <span className="text-[11px] text-white/45 truncate tracking-wide flex-1 min-w-0">{authorName || "Mémo vocal"}</span>
        {editable && !editing && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditing(true)}
            className="w-5 h-5 flex-shrink-0 flex items-center justify-center text-white/30 hover:text-white/70 transition-colors"
            title="Éditer la transcription"
          >
            <Pencil size={12} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {/* Waveform — bande de HAUTEUR FIXE, centrée verticalement dans l'espace
          disponible. Auparavant `flex-1` sans transcription : la waveform
          s'étirait sur toute la hauteur (barres façon fils en format vertical,
          bug 2026-07-18). Désormais une bande constante quel que soit le
          format ; l'espace restant est neutre. */}
      <div className={cn("px-4 flex items-center", showTranscriptSlot ? "flex-shrink-0" : "flex-1 min-h-0")}>
        <div
          className={cn("w-full cursor-pointer", dense ? "h-12" : "h-14")}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seekTo((e.clientX - rect.left) / rect.width);
          }}
        >
          <AudioMemoWaveform peaks={peaks} progress={progress} playing={playing} className="w-full h-full" />
        </div>
      </div>

      {/* Transcription "karaoke" — le mot en cours de lecture se détache
          (opacité + teinte accent), les mots déjà dits restent lisibles, ceux
          à venir sont estompés. Fondu haut/bas façon téléprompteur pour un
          rendu premium sur le texte tronqué. En mode éditable, un clic bascule
          en édition libre (textarea). */}
      {showTranscriptSlot && (
        editing ? (
          <textarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commitEdit}
            placeholder="Transcription…"
            className="flex-1 min-h-0 mx-4 mt-1 mb-2 bg-transparent text-[13px] leading-relaxed text-white/70 resize-none focus:outline-none placeholder:text-white/30"
          />
        ) : cleanTranscript ? (
          <div
            onClick={editable ? () => setEditing(true) : undefined}
            className={cn("flex-1 min-h-0", editable && "cursor-text")}
          >
            <TranscriptKaraoke
              transcript={cleanTranscript}
              wordTimings={wordTimings}
              currentTime={currentTime}
              duration={duration}
              playing={playing}
              className="h-full mx-4 mt-1 mb-2"
              fadeTop="#111114"
              fadeBottom="#0c0c0e"
              activeColor="#c4b5fd"
              baseColor="#ffffff"
            />
          </div>
        ) : (
          <p
            onClick={() => setEditing(true)}
            className="flex-1 min-h-0 mx-4 mt-1 mb-2 text-[13px] italic text-white/30 cursor-text"
          >
            Transcription vide — cliquer pour éditer
          </p>
        )
      )}

      {/* Transport minimal */}
      <div
        className={cn(
          "flex items-center gap-3 px-4 flex-shrink-0",
          dense ? "py-2" : "py-3",
          showTranscriptSlot && "border-t border-white/[0.06]"
        )}
      >
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={togglePlay}
          className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center flex-shrink-0 hover:opacity-90 transition-opacity"
          title={playing ? "Pause" : "Lecture"}
        >
          {playing ? (
            <Pause size={14} strokeWidth={0} fill="currentColor" />
          ) : (
            <Play size={14} strokeWidth={0} fill="currentColor" style={{ marginLeft: 2 }} />
          )}
        </button>
        <span className="text-xs text-white/45 tabular-nums">
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      </div>
    </div>
  );
}

export function AudioBlockCard(props: AudioBlockCardProps) {
  return (
    <AudioPlayerBoundary src={getAudioUrl(props.storageKey)}>
      <AudioBlockCardInner {...props} />
    </AudioPlayerBoundary>
  );
}
