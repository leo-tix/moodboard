"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const BAR_COUNT = 64;

// Lecteur audio custom — remplace le <audio controls> natif (moche, pas de
// waveform, pas d'avance rapide) par une vraie mini-app de lecture façon
// Journal/Notion : waveform réelle (décodée via Web Audio API depuis le
// fichier), clic pour naviguer, ±15s, play/pause, temps écoulé/total.
export function AudioPlayer({ src, durationSec }: { src: string; durationSec?: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSec ?? 0);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  // Décode le fichier une fois pour en extraire la forme d'onde. Best-effort
  // sur plusieurs fronts, tous rencontrés en conditions réelles :
  // - Safari/iOS ne sait pas décoder le webm/opus enregistré sur Chrome ;
  // - le fetch cross-origin vers R2 peut échouer (CORS) ou traîner ;
  // - iOS limite le nombre d'AudioContext simultanés (d'où le close()
  //   systématique en finally — un carnet peut afficher plusieurs lecteurs).
  // Dans TOUS les cas d'échec ou de lenteur (>5s), on affiche un motif de
  // barres déterministe (pseudo-aléatoire seedé sur l'URL) — visuellement une
  // waveform, jamais une zone vide.
  useEffect(() => {
    let cancelled = false;

    // Motif de secours stable pour cette source (même rendu à chaque visite).
    const fallbackBars = () => {
      let seed = 0;
      for (let i = 0; i < src.length; i++) seed = (seed * 31 + src.charCodeAt(i)) >>> 0;
      return Array.from({ length: BAR_COUNT }, (_, i) => {
        seed = (seed * 1103515245 + 12345) >>> 0;
        const r = (seed / 4294967295);
        // Enveloppe douce (plus haut au centre) + variation — façon waveform
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
    const onLoaded = () => setDuration(el.duration || durationSec || 0);
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

  const skip = (delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.min(Math.max(0, el.currentTime + delta), duration || el.duration || 0);
  };

  const seekTo = (ratio: number) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    el.currentTime = Math.min(Math.max(0, ratio * duration), duration);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={togglePlay}
        className="w-8 h-8 flex-shrink-0 rounded-full bg-[var(--text-primary)] text-[var(--bg-base)] flex items-center justify-center hover:opacity-90 transition-opacity"
        title={playing ? "Pause" : "Lecture"}
      >
        {playing ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" /><rect x="14" y="4" width="5" height="16" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 1 }}><path d="M6 4l15 8-15 8V4z" /></svg>
        )}
      </button>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => skip(-15)}
        className="w-6 h-6 flex-shrink-0 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        title="Reculer de 15s"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
        </svg>
      </button>

      {/* Waveform — cliquable pour naviguer */}
      <div
        className="relative flex-1 h-8 flex items-center gap-[2px] cursor-pointer min-w-0"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          seekTo((e.clientX - rect.left) / rect.width);
        }}
      >
        {(peaks ?? Array.from({ length: BAR_COUNT }, () => 0.15)).map((h, i) => {
          const played = i / BAR_COUNT < progress;
          return (
            <span
              key={i}
              className={cn(
                "flex-1 rounded-full transition-colors",
                // border-strong même en placeholder : border-subtle (6% alpha)
                // était invisible sur fond sombre — la zone waveform semblait
                // vide pendant/après un décodage lent ou échoué.
                peaks ? (played ? "bg-[var(--text-primary)]" : "bg-[var(--border-strong)]") : "bg-[var(--border-strong)] animate-pulse"
              )}
              // Hauteur en PIXELS, pas en % : un pourcentage sur un enfant de
              // flexbox peut s'effondrer à 0 sur Safari/iOS (base de calcul
              // ambiguë) — c'était l'autre raison des waveforms invisibles
              // sur mobile. 28px = h-8 (32px) moins un peu de respiration.
              style={{ height: Math.max(2, Math.round(h * 28)) }}
            />
          );
        })}
      </div>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => skip(15)}
        className="w-6 h-6 flex-shrink-0 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        title="Avancer de 15s"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
        </svg>
      </button>

      <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 tabular-nums w-16 text-right">
        {fmt(currentTime)} / {fmt(duration)}
      </span>
    </div>
  );
}
