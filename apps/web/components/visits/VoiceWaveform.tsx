"use client";

import { useEffect, useRef } from "react";

// Waveform vocale réactive façon Siri / Gemini : barres colorées miroir qui
// pulsent avec le niveau du micro EN TEMPS RÉEL, plus une aura floutée
// (glow) dont l'intensité suit le volume. Se branche en écoute passive sur le
// MediaStream déjà acquis (pas de nouveau getUserMedia — un AnalyserNode ne
// perturbe pas le MediaRecorder qui enregistre en parallèle).
export function VoiceWaveform({ stream, className }: { stream: MediaStream | null; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stream) return;
    const canvas = canvasRef.current;
    const glow = glowRef.current;
    if (!canvas) return;

    let audioCtx: AudioContext | null = null;
    let raf = 0;
    let stopped = false;

    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AC();
      // Autoplay policy : un AudioContext peut démarrer "suspended" — le
      // relancer garantit que l'analyser reçoit bien le flux (sinon barres figées).
      void audioCtx.resume?.();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);

      const bins = analyser.frequencyBinCount; // 256
      const data = new Uint8Array(bins);
      const N = 44; // nombre de barres
      const heights = new Float32Array(N); // hauteurs lissées 0..1
      const ctx = canvas.getContext("2d")!;

      const resize = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      window.addEventListener("resize", resize);

      const roundBar = (x: number, y: number, w: number, h: number) => {
        const r = Math.min(w / 2, h / 2);
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
      };

      const draw = () => {
        if (stopped) return;
        raf = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(data);

        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const mid = h / 2;
        ctx.clearRect(0, 0, w, h);

        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, "#5b9bf8");
        grad.addColorStop(0.5, "#a78bfa");
        grad.addColorStop(1, "#f472b6");

        const gap = 3;
        const barW = (w - gap * (N - 1)) / N;
        const usable = Math.floor(bins * 0.66); // la voix vit dans le bas du spectre
        let level = 0;
        for (let i = 0; i < N; i++) {
          // Max sur la PLAGE de bins de la barre (pas un seul bin) — sinon un
          // son à bande étroite tombe "entre" deux barres et n'est pas capté.
          const lo = Math.floor((i / N) * usable);
          const hi = Math.max(lo + 1, Math.floor(((i + 1) / N) * usable));
          let peak = 0;
          for (let b = lo; b < hi; b++) if (data[b] > peak) peak = data[b];
          const v = peak / 255; // 0..1
          level += v;
          // easing : montée vive, descente douce (ressort)
          const target = Math.pow(v, 1.4);
          heights[i] += (target - heights[i]) * (target > heights[i] ? 0.5 : 0.18);
        }
        level /= N;

        ctx.save();
        ctx.shadowColor = `rgba(150,130,255,${0.3 + level * 0.55})`;
        ctx.shadowBlur = 12 + level * 30;
        ctx.fillStyle = grad;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const bh = Math.max(3, heights[i] * (h * 0.92));
          const x = i * (barW + gap);
          roundBar(x, mid - bh / 2, barW, bh);
        }
        ctx.fill();
        ctx.restore();

        // Aura floutée derrière — intensité liée au volume
        if (glow) glow.style.opacity = String(0.25 + Math.min(0.75, level * 1.8));
      };
      draw();

      return () => {
        stopped = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        try { source.disconnect(); analyser.disconnect(); } catch { /* déjà déconnecté */ }
        audioCtx?.close().catch(() => {});
      };
    } catch {
      // Web Audio indisponible → pas de waveform (dégradation silencieuse).
    }
  }, [stream]);

  return (
    <div className={className} style={{ position: "relative" }}>
      <div
        ref={glowRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0.25,
          filter: "blur(16px)",
          background:
            "radial-gradient(60% 120% at 50% 50%, rgba(120,140,255,0.55), rgba(167,139,250,0.35) 45%, rgba(244,114,182,0.15) 70%, transparent 100%)",
          transition: "opacity 90ms linear",
        }}
      />
      <canvas ref={canvasRef} className="relative w-full h-full" />
    </div>
  );
}
