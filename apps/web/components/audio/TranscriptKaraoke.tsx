"use client";

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

// Répartit les mots sur la durée du clip, pondérée par leur longueur (un mot
// long prend plus de temps à dire qu'un mot court) — pas un vrai alignement
// forcé (aucune donnée de timing par mot n'est produite par la transcription
// live Web Speech ni par Whisper local tel qu'utilisé ici), mais une
// approximation qui "danse" de façon crédible avec la lecture, dans l'esprit
// karaoke demandé. Partagé entre le bloc audio du carnet de visite et le
// bloc mémo des planches (demande utilisateur 2026-07-15 : "uniformiser").
export function estimateWordTimings(transcript: string, duration: number): WordTiming[] {
  const words = transcript.split(/\s+/).filter(Boolean);
  if (words.length === 0 || duration <= 0) return [];
  const weights = words.map((w) => w.length + 2); // +2 : pause approximative entre mots
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let cumulative = 0;
  return words.map((word, i) => {
    const start = (cumulative / totalWeight) * duration;
    cumulative += weights[i];
    const end = (cumulative / totalWeight) * duration;
    // Même convention que les timings Whisper : l'espace de séparation est
    // porté PAR le mot (en tête, sauf le premier) → le rendu concatène les
    // tokens sans ajouter d'espace, quelle que soit la source des timings.
    return { word: i === 0 ? word : " " + word, start, end };
  });
}

function findActiveWordIndex(wordTimings: WordTiming[], currentTime: number, duration: number): number {
  if (wordTimings.length === 0) return -1;
  if (currentTime >= duration && duration > 0) return wordTimings.length - 1;
  const idx = wordTimings.findIndex((w) => currentTime >= w.start && currentTime < w.end);
  if (idx !== -1) return idx;
  // Entre deux mots (arrondis) — garde le dernier mot déjà "passé".
  for (let i = wordTimings.length - 1; i >= 0; i--) {
    if (currentTime >= wordTimings[i].start) return i;
  }
  return -1;
}

export interface TranscriptKaraokeProps {
  transcript: string;
  currentTime: number;
  duration: number;
  playing: boolean;
  /** Timings RÉELS par mot (Whisper) — s'ils sont fournis ET cohérents avec le
   *  transcript (même nombre de mots), la surbrillance suit exactement la voix.
   *  Sinon (absents, ou transcript édité depuis), on retombe sur l'estimation
   *  pondérée par la longueur des mots. */
  wordTimings?: WordTiming[] | null;
  className?: string;
  /**
   * `true` (défaut) : zone à hauteur fixe, défilement interne + fondus
   * haut/bas façon téléprompteur (carte planches, hauteur contrainte).
   * `false` : le texte s'écoule naturellement dans son conteneur, sans
   * défilement ni fondu (bloc carnet de visite, hauteur libre).
   */
  scroll?: boolean;
  /** Couleurs des fondus haut/bas en mode scroll — doivent matcher le fond du conteneur. */
  fadeTop?: string;
  fadeBottom?: string;
  activeColor?: string;
  baseColor?: string;
}

// Transcription "karaoke" — le mot en cours de lecture se détache (opacité +
// teinte accent), les mots déjà dits restent lisibles, ceux à venir sont
// estompés. Utilisé par AudioBlockCard (planches ET carnet de visite), avec
// une mise en page adaptée à chaque contexte via `scroll`.
export function TranscriptKaraoke({
  transcript,
  currentTime,
  duration,
  playing,
  wordTimings: realTimings,
  className,
  scroll = true,
  fadeTop,
  fadeBottom,
  activeColor = "#c4b5fd",
  baseColor = "#ffffff",
}: TranscriptKaraokeProps) {
  // Priorité aux timings RÉELS de Whisper : on affiche ALORS directement les
  // mots issus des timings (avec leurs start/end exacts), sans les ré-aligner
  // sur un split du transcript. Whisper découpe les mots autrement qu'un simple
  // split (« qu'est-ce », « l'exposition »…), donc exiger le même nombre de
  // mots faisait échouer l'alignement quasi systématiquement → tout retombait
  // sur l'estimation (retour utilisateur 2026-07-19 « toujours approximatif »).
  // Le transcript édité met déjà `realTimings` à null (repli estimation propre).
  const wordTimings = useMemo(() => {
    if (realTimings && realTimings.length > 0) return realTimings;
    return estimateWordTimings(transcript, duration);
  }, [realTimings, transcript, duration]);
  const activeWordIndex = useMemo(
    () => findActiveWordIndex(wordTimings, currentTime, duration),
    [wordTimings, currentTime, duration]
  );

  const activeWordRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (scroll && playing) activeWordRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeWordIndex, playing, scroll]);

  if (wordTimings.length === 0) {
    return (
      <p className={cn("text-[13px] leading-relaxed", className)} style={{ color: baseColor, opacity: 0.6 }}>
        {transcript}
      </p>
    );
  }

  const words = (
    <p className="text-[13px] leading-relaxed" style={scroll ? { textWrap: "pretty" } : undefined}>
      {wordTimings.map((w, i) => (
        <span
          key={i}
          ref={i === activeWordIndex ? activeWordRef : undefined}
          className="transition-[opacity,color] duration-200"
          style={{
            opacity: i === activeWordIndex ? 1 : i < activeWordIndex ? 0.55 : 0.32,
            color: i === activeWordIndex ? activeColor : baseColor,
            fontWeight: i === activeWordIndex ? 600 : 400,
            whiteSpace: "pre-wrap",
          }}
        >
          {w.word}
        </span>
      ))}
    </p>
  );

  if (!scroll) {
    return <div className={className}>{words}</div>;
  }

  const topFade = fadeTop ?? fadeBottom ?? "transparent";
  const bottomFade = fadeBottom ?? fadeTop ?? "transparent";

  return (
    <div className={cn("relative", className)}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-3 z-10"
        style={{ background: `linear-gradient(to bottom, ${topFade}, transparent)` }}
      />
      <div className="h-full overflow-y-auto scrollbar-none py-1.5">{words}</div>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-3 z-10"
        style={{ background: `linear-gradient(to top, ${bottomFade}, transparent)` }}
      />
    </div>
  );
}
