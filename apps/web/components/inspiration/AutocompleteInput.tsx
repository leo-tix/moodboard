"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type SuggestField = "author" | "studio" | "year" | "title" | "tag";

interface AutocompleteInputProps {
  field: SuggestField;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Class applied to the inner <input> element */
  inputClassName?: string;
  type?: string;
}

interface DropPos { top: number; left: number; width: number }

export function AutocompleteInput({
  field, value, onChange, placeholder, inputClassName, type = "text",
}: AutocompleteInputProps) {
  const [suggestions, setSuggestions]   = useState<string[]>([]);
  const [open, setOpen]                 = useState(false);
  const [activeIdx, setActiveIdx]       = useState(-1);
  const [dropPos, setDropPos]           = useState<DropPos>({ top: 0, left: 0, width: 0 });
  const inputRef  = useRef<HTMLInputElement>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch suggestions with 180 ms debounce ──
  const fetchSuggestions = useCallback(async (q: string) => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggestions?field=${field}&q=${encodeURIComponent(q)}`);
        const data = await res.json() as { suggestions: string[] };
        const filtered = data.suggestions.filter((s) => s !== q);
        setSuggestions(filtered);
        setOpen(filtered.length > 0);
        setActiveIdx(-1);
      } catch {
        setSuggestions([]);
        setOpen(false);
      }
    }, 180);
  }, [field]);

  // Recalculate dropdown position (fixed, escapes overflow containers)
  const calcPos = () => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setDropPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 160) });
  };

  // Update position on scroll/resize while open
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

  const select = (s: string) => {
    onChange(s);
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    fetchSuggestions(e.target.value);
  };

  const handleFocus = () => {
    calcPos();
    fetchSuggestions(value);
  };

  const handleBlur = () => {
    // Delay so mousedown on suggestion fires first
    setTimeout(() => { setOpen(false); setActiveIdx(-1); }, 150);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      select(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type={type}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={inputClassName}
        autoComplete="off"
      />

      {/* Fixed-position dropdown — escapes overflow:auto containers */}
      {open && suggestions.length > 0 && (
        <div
          style={{ position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
          className="bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-md shadow-xl overflow-hidden"
        >
          {suggestions.map((s, i) => (
            <button
              key={s}
              type="button"
              // preventDefault prevents input blur before click registers
              onMouseDown={(e) => { e.preventDefault(); select(s); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
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
