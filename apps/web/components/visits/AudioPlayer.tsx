"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { AudioMemoWaveform } from "@/components/audio/AudioMemoWaveform";

// Résolution de décodage des pics d'amplitude (indépendante du nombre de
// barres réellement dessinées — AudioMemoWaveform rééchantillonne).
const BAR_COUNT = 64;

// Lecteur audio custom — remplace le <audio controls> natif (moche, pas de
// waveform, pas d'avance rapide) par une vraie mini-app de lecture façon
// Journal/Notion : waveform réelle (décodée via Web Audio API depuis le
// fichier), clic pour naviguer, ±15s, play/pause, temps écoulé/total.
//
// `compact` : rendu resserré pour les contextes étroits (bloc audio dans une
// pile de colonne, 2 colonnes sur mobile — largeur utile ~125-140px). Les
// boutons ±15s (48px+gaps à eux seuls) et l'affichage "0:00 / 0:00" (64px
// fixes) ne laissaient sinon aucune place à la waveform, qui s'écrasait ou
// débordait de la carte (retour utilisateur 2026-07-14).
export function AudioPlayer({
  src,
  durationSec,
  compact = false,
}: {
  src: string;
  durationSec?: number | null;
  compact?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSec ?? 0);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  // `compact` signale une intention ("ce bloc est dans une pile de colonne,
  // resserre-toi SI BESOIN") — sans ce garde-fou viewport, il s'appliquait
  // aussi sur desktop où les colonnes sont largement assez larges pour la
  // version complète, écrasant inutilement la waveform/masquant les ±15s
  // (retour utilisateur 2026-07-14 : "l'affichage n'est pas optimisé").
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsNarrowViewport(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const effectiveCompact = compact && isNarrowViewport;

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
    // `el.duration` peut valoir Infinity pour un webm produit par
    // MediaRecorder (durée absente de l'en-tête tant que le fichier n'a pas
    // été entièrement lu/seeké — bug connu de Chrome) — Infinity étant
    // "truthy", `el.duration || durationSec` ne retombait jamais sur la
    // durée connue au moment de l'enregistrement, et fmt(Infinity) affichait
    // littéralement "Infinity:NaN" (retour utilisateur 2026-07-14).
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
  const playSize = effectiveCompact ? "w-6 h-6" : "w-8 h-8";

  return (
    <div className={cn("flex items-center flex-1 min-w-0", effectiveCompact ? "gap-1" : "gap-2")}>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={togglePlay}
        className={cn(playSize, "flex-shrink-0 rounded-full bg-[var(--text-primary)] text-[var(--bg-base)] flex items-center justify-center hover:opacity-90 transition-opacity")}
        title={playing ? "Pause" : "Lecture"}
      >
        {playing ? (
          <Pause size={effectiveCompact ? 11 : 14} strokeWidth={0} fill="currentColor" />
        ) : (
          <Play size={effectiveCompact ? 11 : 14} strokeWidth={0} fill="currentColor" style={{ marginLeft: 1 }} />
        )}
      </button>

      {/* ±15s — masqués en compact : dans une pile de colonne (~125-140px
          utiles), ces deux boutons + leurs gaps ne laissaient plus de place
          réelle à la waveform, qui s'écrasait ou débordait de la carte
          (retour utilisateur 2026-07-14). Le tap-pour-naviguer sur la
          waveform reste disponible, c'est le geste principal de toute façon. */}
      {!effectiveCompact && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => skip(-15)}
          className="w-6 h-6 flex-shrink-0 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title="Reculer de 15s"
        >
          <RotateCcw size={15} strokeWidth={1.8} />
        </button>
      )}

      {/* Waveform — cliquable pour naviguer. Même composant/style/comportement
          que la waveform d'enregistrement (VoiceWaveform) — demande
          utilisateur 2026-07-14 : lecture "réactive", identique à
          l'enregistrement, partagée entre carnet de visite et planches. */}
      <div
        className={cn("relative flex-1 cursor-pointer min-w-0", effectiveCompact ? "h-5" : "h-8")}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          seekTo((e.clientX - rect.left) / rect.width);
        }}
      >
        <AudioMemoWaveform peaks={peaks} progress={progress} playing={playing} className="w-full h-full" />
      </div>

      {!effectiveCompact && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => skip(15)}
          className="w-6 h-6 flex-shrink-0 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title="Avancer de 15s"
        >
          <RotateCw size={15} strokeWidth={1.8} />
        </button>
      )}

      {/* Temps : en compact, juste le total (identité du clip) — la valeur
          courante change à chaque frame de lecture et un libellé "0:12/1:34"
          fixe à 64px ne rentrait plus une fois la waveform déduite. */}
      {effectiveCompact ? (
        <span className="text-[9px] text-[var(--text-tertiary)] flex-shrink-0 tabular-nums">
          {fmt(playing ? currentTime : duration)}
        </span>
      ) : (
        <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 tabular-nums w-16 text-right">
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      )}
    </div>
  );
}
