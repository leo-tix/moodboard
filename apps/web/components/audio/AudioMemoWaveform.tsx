"use client";

import { useEffect, useRef } from "react";

// Waveform de LECTURE — même canvas, même palette, même ressort et même aura
// floutée que VoiceWaveform.tsx (waveform d'ENREGISTREMENT), pour que
// l'enregistrement et la lecture d'un mémo vocal soient visuellement et
// comportementalement identiques partout dans l'app (carnet de visite comme
// planches moodboard — demande utilisateur 2026-07-14 : "unifié", "reprendre
// exactement le même comportement et design").
//
// VoiceWaveform lit un AnalyserNode branché sur un MediaStream micro EN
// DIRECT — un fichier déjà enregistré n'a pas de flux live équivalent de
// façon fiable cross-navigateur (`HTMLMediaElement.captureStream()` n'existe
// pas sur Safari desktop/iOS). La "réactivité" est donc simulée ici à partir
// des pics d'amplitude réels du fichier (`peaks`, décodés une fois via
// Web Audio API par l'appelant) : les barres proches de la position de
// lecture actuelle reçoivent une impulsion (ressort identique à
// VoiceWaveform) proportionnelle à l'amplitude RÉELLE du clip à cet
// endroit — la waveform "danse" en suivant le contenu audio au fil de la
// lecture, sans dépendre d'une analyse en temps réel.
const N = 44; // même nombre de barres que VoiceWaveform, cohérence visuelle

interface AudioMemoWaveformProps {
  /** Pics d'amplitude 0..1, longueur quelconque (rééchantillonnés sur N barres). */
  peaks: number[] | null;
  /** Position de lecture 0..1. */
  progress: number;
  playing: boolean;
  className?: string;
}

export function AudioMemoWaveform({ peaks, progress, playing, className }: AudioMemoWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  // Refs plutôt que deps d'effet : la position de lecture change à chaque
  // frame pendant la lecture (`timeupdate`), un effet qui se redéclenche à
  // chaque changement redémarrerait toute la boucle rAF en continu.
  const peaksRef = useRef(peaks);
  peaksRef.current = peaks;
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    const canvas = canvasRef.current;
    const glow = glowRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let stopped = false;
    const heights = new Float32Array(N);

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    // Le canvas change de taille quand la tuile change de format (1x1 → 2x2…)
    // ou au chargement des polices — sans resync la mémoire de dessin reste à
    // l'ancienne taille et la waveform apparaît compressée / dédoublée
    // (bug constaté 2026-07-18). ResizeObserver couvre tous ces cas.
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const roundBar = (x: number, y: number, w: number, h: number) => {
      const r = Math.min(w / 2, h / 2);
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
    };

    const sourceFor = (i: number) => {
      const p = peaksRef.current;
      if (!p || p.length === 0) return 0.15;
      return p[Math.min(p.length - 1, Math.floor((i / N) * p.length))] ?? 0.15;
    };

    const draw = () => {
      if (stopped) return;
      raf = requestAnimationFrame(draw);

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const mid = h / 2;
      const progressNow = progressRef.current;
      const playingNow = playingRef.current;
      const playIdx = progressNow * N;

      const gap = w < 120 ? 1 : 2;
      const barW = Math.max(1, (w - gap * (N - 1)) / N);

      let pulseLevel = 0;
      const bars: { x: number; bh: number; played: boolean }[] = [];
      for (let i = 0; i < N; i++) {
        const base = sourceFor(i);
        const dist = Math.abs(i - playIdx);
        // Impulsion "ressort" identique à VoiceWaveform (montée vive,
        // descente douce), mais déclenchée par la proximité de la tête de
        // lecture plutôt que par un niveau micro en direct.
        const pulse = playingNow ? Math.max(0, 1 - dist / 2.2) : 0;
        const target = Math.min(1, base * (1 + pulse * 0.7));
        heights[i] += (target - heights[i]) * (target > heights[i] ? 0.5 : 0.15);
        if (pulse > 0.3) pulseLevel = Math.max(pulseLevel, heights[i]);
        // Hauteur de barre bornée : dans un conteneur haut (tuile format
        // vertical/grand) `h * 0.92` produisait des barres démesurées façon
        // fils (bug 2026-07-18). On plafonne la bande dessinée et on la centre
        // (mid = h/2), pour une waveform d'aspect constant quel que soit le
        // format de la tuile.
        const band = Math.min(h * 0.92, 68);
        const bh = Math.max(2, heights[i] * band);
        bars.push({ x: i * (barW + gap), bh, played: i / N < progressNow });
      }

      ctx.clearRect(0, 0, w, h);
      ctx.save();

      // Barres non jouées : neutres, sans aura.
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.beginPath();
      for (const b of bars) if (!b.played) roundBar(b.x, mid - b.bh / 2, barW, b.bh);
      ctx.fill();

      // Barres jouées : même dégradé + aura que l'enregistrement.
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "#5b9bf8");
      grad.addColorStop(0.5, "#a78bfa");
      grad.addColorStop(1, "#f472b6");
      ctx.shadowColor = `rgba(150,130,255,${0.3 + pulseLevel * 0.5})`;
      ctx.shadowBlur = 10 + pulseLevel * 24;
      ctx.fillStyle = grad;
      ctx.beginPath();
      for (const b of bars) if (b.played) roundBar(b.x, mid - b.bh / 2, barW, b.bh);
      ctx.fill();
      ctx.restore();

      if (glow) glow.style.opacity = String(playingNow ? 0.15 + Math.min(0.55, pulseLevel * 1.3) : 0);
    };
    draw();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className={className} style={{ position: "relative" }}>
      <div
        ref={glowRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0,
          filter: "blur(16px)",
          background:
            "radial-gradient(60% 120% at 50% 50%, rgba(120,140,255,0.55), rgba(167,139,250,0.35) 45%, rgba(244,114,182,0.15) 70%, transparent 100%)",
          transition: "opacity 150ms linear",
        }}
      />
      <canvas ref={canvasRef} className="relative w-full h-full" />
    </div>
  );
}
