"use client";

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
  /** If true, fetch tag suggestions from the DB while typing */
  withSuggestions?: boolean;
}

interface DropPos { top: number; left: number; width: number }

export function TagInput({
  value,
  onChange,
  placeholder = "Ajouter un tag…",
  className,
  withSuggestions = false,
}: TagInputProps) {
  const [input, setInput]               = useState("");
  const [suggestions, setSuggestions]   = useState<string[]>([]);
  const [open, setOpen]                 = useState(false);
  const [activeIdx, setActiveIdx]       = useState(-1);
  const [dropPos, setDropPos]           = useState<DropPos>({ top: 0, left: 0, width: 0 });
  const inputRef   = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (!tag || value.includes(tag)) return;
    onChange([...value, tag]);
    setInput("");
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
  };

  const removeTag = (tag: string) => onChange(value.filter((t) => t !== tag));

  // ── Suggestions ──
  const calcPos = () => {
    const el = wrapperRef.current ?? inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setDropPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 160) });
  };

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!withSuggestions) return;
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggestions?field=tag&q=${encodeURIComponent(q)}`);
        const data = await res.json() as { suggestions: string[] };
        // Filter out already-added tags
        const filtered = data.suggestions.filter((s) => !value.includes(s) && s !== q);
        setSuggestions(filtered);
        setOpen(filtered.length > 0);
        setActiveIdx(-1);
      } catch {
        setSuggestions([]);
        setOpen(false);
      }
    }, 180);
  }, [withSuggestions, value]);

  useEffect(() => {
    if (!open) return;
    const update = () => calcPos();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const selectSuggestion = (s: string) => {
    addTag(s);
    inputRef.current?.focus();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInput(v);
    if (v.trim()) {
      calcPos();
      fetchSuggestions(v);
    } else {
      setSuggestions([]);
      setOpen(false);
    }
  };

  const handleFocus = () => {
    calcPos();
    if (input.trim()) fetchSuggestions(input);
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (input.trim()) addTag(input);
      setOpen(false);
      setActiveIdx(-1);
    }, 150);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Suggestion navigation
    if (open && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, -1));
        return;
      }
      if (e.key === "Enter" && activeIdx >= 0) {
        e.preventDefault();
        selectSuggestion(suggestions[activeIdx]);
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        setActiveIdx(-1);
        return;
      }
    }

    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && !input && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  return (
    <>
      <div
        ref={wrapperRef}
        className={cn(
          "min-h-[36px] flex flex-wrap gap-1.5 items-center bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-2 py-1.5 cursor-text focus-within:border-[var(--border-default)] transition-colors",
          className
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] text-[10px] rounded-sm"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={value.length === 0 ? placeholder : ""}
          autoComplete="off"
          className="flex-1 min-w-[120px] bg-transparent text-[var(--text-primary)] text-xs outline-none placeholder:text-[var(--text-tertiary)]"
        />
      </div>

      {/* Suggestions dropdown */}
      {open && suggestions.length > 0 && (
        <div
          style={{ position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
          className="bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-md shadow-xl overflow-hidden"
        >
          {suggestions.map((s, i) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
              className={`w-full text-left px-3 py-1.5 text-[10px] transition-colors ${
                i === activeIdx
                  ? "bg-[var(--bg-overlay)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
