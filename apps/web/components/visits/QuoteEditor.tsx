"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Bloc "citation" du carnet — texte brut (pas de HTML/Tiptap : une citation
// n'a pas besoin de formatage riche, juste d'une mise en avant typographique
// via `.note-prose blockquote`, voir globals.css). Même vocabulaire
// d'auto-save ●/✓ que NoteEditor pour rester cohérent visuellement.

interface QuoteEditorProps {
  content: string;
  editable: boolean;
  onBlurSave: (text: string) => void;
  onAutoSave?: (text: string) => Promise<void>;
  placeholder?: string;
  className?: string;
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
const AUTOSAVE_DEBOUNCE_MS = 800;

export function QuoteEditor({ content, editable, onBlurSave, onAutoSave, placeholder, className }: QuoteEditorProps) {
  const [value, setValue] = useState(content);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<number | null>(null);
  const savedFadeRef = useRef<number | null>(null);

  // Resynchronise si le contenu change de l'extérieur (hors édition).
  useEffect(() => {
    if (!editable) setValue(content);
  }, [content, editable]);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(autoResize, [value, editable]);

  useEffect(() => {
    if (editable) {
      textareaRef.current?.focus();
      const len = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(len, len);
    }
  }, [editable]);

  useEffect(() => () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (savedFadeRef.current) window.clearTimeout(savedFadeRef.current);
  }, []);

  const scheduleAutoSave = (text: string) => {
    if (!onAutoSave) return;
    setSaveState("dirty");
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        await onAutoSave(text);
        setSaveState("saved");
        if (savedFadeRef.current) window.clearTimeout(savedFadeRef.current);
        savedFadeRef.current = window.setTimeout(() => setSaveState("idle"), 1600);
      } catch {
        setSaveState("error");
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  if (!editable) {
    // `.note-prose blockquote` (globals.css) est un sélecteur descendant —
    // le blockquote doit être un ENFANT du conteneur .note-prose, pas
    // porter la classe lui-même, sinon le style de citation ne s'applique
    // jamais.
    return (
      <div className={cn("note-prose", className)}>
        <blockquote>
          {value.trim() ? (
            <p>{value}</p>
          ) : (
            placeholder && <span className="text-[var(--text-tertiary)] italic text-sm not-italic">{placeholder}</span>
          )}
        </blockquote>
      </div>
    );
  }

  return (
    <div className={cn("relative flex-1 min-w-0", className)}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          scheduleAutoSave(e.target.value);
        }}
        onBlur={() => {
          if (debounceRef.current) window.clearTimeout(debounceRef.current);
          setSaveState("idle");
          onBlurSave(value);
        }}
        rows={1}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent text-[var(--text-primary)] text-[1.06em] italic leading-relaxed focus:outline-none placeholder:text-[var(--text-tertiary)] placeholder:not-italic"
      />
      <span className="absolute -top-1 right-0 text-[10px] select-none" aria-live="polite">
        {saveState === "dirty" && <span className="text-[var(--text-tertiary)]">●</span>}
        {saveState === "saving" && <span className="text-[var(--text-tertiary)] animate-pulse">●</span>}
        {saveState === "saved" && <span className="text-[var(--accent)]">✓</span>}
        {saveState === "error" && <span className="text-red-400">⚠ non sauvegardé</span>}
      </span>
    </div>
  );
}
