"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAudioUrl, getImageUrl } from "@/lib/storage/urls";
import { AudioMemoWaveform } from "@/components/audio/AudioMemoWaveform";
import { AudioPlayerBoundary } from "@/components/visits/AudioPlayerBoundary";

const BAR_COUNT = 64;

export interface AudioMemoCardProps {
  storageKey: string;
  durationSec: number | null;
  authorName?: string | null;
  authorImage?: string | null;
  className?: string;
}

// Bloc mémo vocal des planches — carte carrée sombre inspirée du "voice
// recorder widget" fourni en référence (2026-07-14) : waveform réactive en
// grand, avatar de l'auteur, transport minimal en bas. Réutilise le MÊME
// décodage de pics + la MÊME waveform (AudioMemoWaveform) que le carnet de
// visite (components/visits/AudioPlayer.tsx) — juste une autre mise en page
// autour, adaptée au canvas (carte carrée redimensionnable) plutôt qu'à une
// barre horizontale de texte.
function AudioMemoCardInner({ storageKey, durationSec, authorName, authorImage, className }: AudioMemoCardProps) {
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

  return (
    <div
      className={cn(
        "w-full h-full rounded-2xl bg-[#111114] border border-white/10 shadow-2xl flex flex-col overflow-hidden select-none",
        className
      )}
    >
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      {/* Auteur — avatar + nom, façon widget de référence */}
      <div className="flex items-center gap-2 px-4 pt-4 flex-shrink-0">
        <div className="w-6 h-6 rounded-full overflow-hidden bg-white/10 flex-shrink-0 border border-white/10 flex items-center justify-center">
          {authorImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getImageUrl(authorImage)} alt="" className="w-full h-full object-cover" draggable={false} />
          ) : authorName ? (
            <span className="text-[10px] text-white/70 font-medium">{authorName[0]?.toUpperCase()}</span>
          ) : (
            <Mic size={11} strokeWidth={1.75} className="text-white/50" />
          )}
        </div>
        <span className="text-[11px] text-white/50 truncate">{authorName || "Mémo vocal"}</span>
      </div>

      {/* Waveform — cliquable pour naviguer, prend le plus de place */}
      <div
        className="flex-1 min-h-0 px-4 py-2 cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          seekTo((e.clientX - rect.left) / rect.width);
        }}
      >
        <AudioMemoWaveform peaks={peaks} progress={progress} playing={playing} className="w-full h-full" />
      </div>

      {/* Transport minimal */}
      <div className="flex items-center gap-3 px-4 pb-4 flex-shrink-0">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center flex-shrink-0 hover:opacity-90 transition-opacity"
          title={playing ? "Pause" : "Lecture"}
        >
          {playing ? (
            <Pause size={15} strokeWidth={0} fill="currentColor" />
          ) : (
            <Play size={15} strokeWidth={0} fill="currentColor" style={{ marginLeft: 2 }} />
          )}
        </button>
        <span className="text-xs text-white/50 tabular-nums">
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
