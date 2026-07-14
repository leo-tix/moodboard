"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAudioUrl, getImageUrl } from "@/lib/storage/urls";
import { AudioMemoWaveform } from "@/components/audio/AudioMemoWaveform";
import { TranscriptKaraoke } from "@/components/audio/TranscriptKaraoke";
import { AudioPlayerBoundary } from "@/components/visits/AudioPlayerBoundary";

const BAR_COUNT = 64;

export interface AudioMemoCardProps {
  storageKey: string;
  durationSec: number | null;
  transcript?: string | null;
  authorName?: string | null;
  authorImage?: string | null;
  className?: string;
}

// Bloc mémo vocal des planches — carte sombre inspirée du "voice recorder
// widget" fourni en référence : waveform réactive, avatar de l'auteur,
// transcription "karaoke" qui se révèle mot par mot pendant la lecture,
// transport minimal. Réutilise le MÊME décodage de pics + la MÊME waveform
// (AudioMemoWaveform) que le carnet de visite (AudioPlayer.tsx).
function AudioMemoCardInner({ storageKey, durationSec, transcript, authorName, authorImage, className }: AudioMemoCardProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSec ?? 0);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const src = getAudioUrl(storageKey);

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

  return (
    <div
      className={cn(
        "w-full h-full rounded-[20px] bg-gradient-to-b from-[#17171b] to-[#0c0c0e] border border-white/[0.08] shadow-2xl shadow-black/40 flex flex-col overflow-hidden select-none",
        className
      )}
    >
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      {/* Auteur — avatar + nom */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-1 flex-shrink-0">
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
        <span className="text-[11px] text-white/45 truncate tracking-wide">{authorName || "Mémo vocal"}</span>
      </div>

      {/* Waveform — cliquable pour naviguer */}
      <div
        className={cn("flex-shrink-0 px-4 py-2 cursor-pointer", cleanTranscript ? "h-14" : "flex-1 min-h-0")}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          seekTo((e.clientX - rect.left) / rect.width);
        }}
      >
        <AudioMemoWaveform peaks={peaks} progress={progress} playing={playing} className="w-full h-full" />
      </div>

      {/* Transcription "karaoke" — le mot en cours de lecture se détache
          (opacité + teinte accent), les mots déjà dits restent lisibles, ceux
          à venir sont estompés. Fondu haut/bas façon téléprompteur pour un
          rendu premium sur le texte tronqué. */}
      {cleanTranscript && (
        <TranscriptKaraoke
          transcript={cleanTranscript}
          currentTime={currentTime}
          duration={duration}
          playing={playing}
          className="flex-1 min-h-0 mx-4 mt-1 mb-2"
          fadeTop="#111114"
          fadeBottom="#0c0c0e"
          activeColor="#c4b5fd"
          baseColor="#ffffff"
        />
      )}

      {/* Transport minimal */}
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 flex-shrink-0",
          cleanTranscript && "border-t border-white/[0.06]"
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

export function AudioMemoCard(props: AudioMemoCardProps) {
  return (
    <AudioPlayerBoundary src={getAudioUrl(props.storageKey)}>
      <AudioMemoCardInner {...props} />
    </AudioPlayerBoundary>
  );
}
