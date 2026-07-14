"use client";

import { useCallback, useRef } from "react";
import { Search } from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface SearchBarProps {
  placeholder?: string;
  autoFocus?: boolean;
}

export function SearchBar({
  placeholder = "Rechercher une inspiration, un auteur, un tag…",
  autoFocus,
}: SearchBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentQuery = searchParams.get("q") ?? "";

  const updateQuery = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set("q", value);
      } else {
        params.delete("q");
      }
      params.delete("page"); // Reset pagination à chaque nouvelle recherche
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => updateQuery(value), 300);
  };

  return (
    <div className="relative">
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none flex">
        <Search size={16} strokeWidth={1.75} />
      </span>
      <input
        type="search"
        defaultValue={currentQuery}
        onChange={handleChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-[var(--border-default)] transition-colors"
      />
      {currentQuery && (
        <button
          onClick={() => updateQuery("")}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] text-xs transition-colors"
        >
          ×
        </button>
      )}
    </div>
  );
}
