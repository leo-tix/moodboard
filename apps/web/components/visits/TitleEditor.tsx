"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Bloc "titre" du carnet — texte brut (comme QuoteEditor, pas de rich text :
// un titre n'a pas besoin de formatage). Grand serif arrondi (Fraunces,
// utilitaire Tailwind `font-serif` mappé sur --font-serif dans globals.css)
// pour se différencier nettement du corps de texte — promu bloc autonome le
// 2026-07-13 (avant : formatage H2 à l'intérieur d'un bloc texte).

interface TitleEditorProps {
  content: string;
  editable: boolean;
  onBlurSave: (text: string) => void;
  onAutoSave?: (text: string) => Promise<void>;
  placeholder?: string;
  className?: string;
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
const AUTOSAVE_DEBOUNCE_MS = 800;
const TITLE_STYLE = "font-serif text-3xl md:text-4xl font-semibold tracking-tight leading-[1.1]";

export function TitleEditor({ content, editable, onBlurSave, onAutoSave, placeholder, className }: TitleEditorProps) {
  const [value, setValue] = useState(content);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<number | null>(null);
  const savedFadeRef = useRef<number | null>(null);

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
    return (
      <h2 className={cn(TITLE_STYLE, "text-[var(--text-primary)]", className)}>
        {value.trim() || (placeholder && <span className="text-[var(--text-tertiary)] font-sans text-base font-normal">{placeholder}</span>)}
      </h2>
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
        className={cn(TITLE_STYLE, "w-full resize-none bg-transparent text-[var(--text-primary)] focus:outline-none placeholder:text-[var(--text-tertiary)] placeholder:font-sans placeholder:text-base placeholder:font-normal")}
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
