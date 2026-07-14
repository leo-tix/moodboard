"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Square, Mic, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { pickSupportedAudioMimeType, requestMicrophone } from "@/lib/audio/recorder";
import { transcribeBlobLocally, type TranscribeProgress } from "@/lib/audio/transcribe";

export interface CreatedAudioBlock {
  id: string;
  storageKey: string;
  durationSec: number | null;
  transcript: string | null;
}

// Enregistreur autonome pour le bloc "Audio" du carnet — utilisé pour la
// création d'un bloc audio top-level et pour remplir un slot de colonnes.
// Contrairement à l'ancien AudioBlock Tiptap, il ne dépend plus d'un éditeur :
// il POST directement /api/visits/[id]/audio et rend le bloc créé au parent.
export function AudioRecorderInline({
  visitId,
  onClose,
  onCreated,
}: {
  visitId: string;
  onClose: () => void;
  onCreated: (audio: CreatedAudioBlock) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [transcribing, setTranscribing] = useState<TranscribeProgress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);

  const previewUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  const startRecording = async () => {
    setError(null);
    const mic = await requestMicrophone();
    if (!mic.ok) {
      setError(mic.error);
      return;
    }
    streamRef.current = mic.stream;

    const supported = pickSupportedAudioMimeType();
    try {
      const recorder = supported ? new MediaRecorder(mic.stream, { mimeType: supported }) : new MediaRecorder(mic.stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        mic.stream.getTracks().forEach((t) => t.stop());
        if (chunksRef.current.length === 0) {
          setRecording(false);
          setError("Aucun son capté — réessaie l'enregistrement.");
          return;
        }
        setBlob(new Blob(chunksRef.current, { type: recorder.mimeType || supported || "audio/webm" }));
        setDurationSec(Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)));
      };
      mic.stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (recorderRef.current && recorderRef.current.state !== "inactive") {
            try { recorderRef.current.stop(); } catch { /* déjà arrêté */ }
          }
        };
      });
      recorder.onerror = () => {
        mic.stream.getTracks().forEach((t) => t.stop());
        setError("Erreur d'enregistrement — réessaie.");
        setRecording(false);
      };
      startedAtRef.current = Date.now();
      recorder.start();
      setRecording(true);
    } catch {
      mic.stream.getTracks().forEach((t) => t.stop());
      setError("Format d'enregistrement non pris en charge par ce navigateur.");
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    setRecording(false);
    if (!recorder || recorder.state === "inactive") return;
    try {
      recorder.stop();
    } catch {
      setError("Erreur lors de l'arrêt de l'enregistrement.");
    }
  };

  const transcribeLocally = async () => {
    if (!blob || transcribing) return;
    setError(null);
    setTranscribing({ phase: "decoding" });
    try {
      const text = await transcribeBlobLocally(blob, setTranscribing);
      if (text) setTranscript(text);
      else setError("Rien à transcrire (silence ou parole non détectée).");
    } catch (err) {
      const detail = err instanceof Error ? ` (${err.message.slice(0, 120)})` : "";
      setError(`Transcription impossible${detail}.`);
    } finally {
      setTranscribing(null);
    }
  };

  const confirmUpload = async () => {
    if (!blob) return;
    setUploading(true);
    setError(null);
    try {
      const ext = (blob.type.split(";")[0].split("/")[1]) || "webm";
      const fd = new FormData();
      fd.append("file", blob, `clip.${ext}`);
      fd.append("durationSec", String(durationSec));
      if (transcript.trim()) fd.append("transcript", transcript.trim());
      const res = await fetch(`/api/visits/${visitId}/audio`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de l'envoi");
        return;
      }
      onCreated({ id: data.id, storageKey: data.storageKey, durationSec: data.durationSec, transcript: data.transcript ?? null });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="w-64 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">Bloc audio</p>
        <button type="button" onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex items-center"><X size={14} strokeWidth={2} /></button>
      </div>
      {error && <p className="text-[10px] text-red-400 mb-2">{error}</p>}
      {!blob ? (
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          className={cn(
            "w-full py-2 rounded-md text-xs font-medium transition-colors",
            recording ? "bg-red-500/20 text-red-400" : "bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-base)]"
          )}
        >
          <span className="inline-flex items-center gap-1.5">{recording ? <><Square size={13} strokeWidth={2} fill="currentColor" /> Arrêter</> : <><Mic size={13} strokeWidth={1.75} /> Enregistrer</>}</span>
        </button>
      ) : (
        <div className="space-y-2">
          {previewUrl && <audio controls src={previewUrl} className="w-full h-8" />}
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={2}
            placeholder="Transcription (modifiable, ou vide)…"
            className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-md px-2 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-default)] resize-y placeholder:text-[var(--text-tertiary)]"
          />
          {!transcript.trim() && (
            <button
              type="button"
              onClick={transcribeLocally}
              disabled={transcribing !== null}
              className="w-full py-1.5 rounded-md text-[10px] text-[var(--text-secondary)] border border-dashed border-[var(--border-default)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-60"
            >
              {transcribing === null
                ? <span className="inline-flex items-center gap-1.5"><Pencil size={12} strokeWidth={1.75} /> Transcrire (local, ~40 Mo au 1er usage)</span>
                : transcribing.phase === "downloading"
                  ? `Téléchargement… ${transcribing.loadedMB ?? 0}/${transcribing.totalMB ?? "?"} Mo`
                  : transcribing.phase === "transcribing"
                    ? "Transcription en cours…"
                    : "Préparation…"}
            </button>
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => { setBlob(null); setTranscript(""); }}
              className="flex-1 py-1.5 rounded-md text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-[var(--border-default)] transition-colors"
            >
              Refaire
            </button>
            <button
              type="button"
              onClick={confirmUpload}
              disabled={uploading}
              className="flex-1 py-1.5 rounded-md text-[11px] bg-[var(--text-primary)] text-[var(--bg-base)] disabled:opacity-50 transition-opacity"
            >
              {uploading ? "…" : "Ajouter"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
