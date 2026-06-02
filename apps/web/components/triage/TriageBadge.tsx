"use client";

import { useState, useEffect } from "react";

export function TriageBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/triage/count")
      .then((r) => r.json())
      .then((d) => setCount(d.count ?? 0))
      .catch(() => {});
  }, []);

  if (!count) return null;

  return (
    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--accent,#a78bfa)] text-[var(--bg-base)] text-[10px] font-bold flex items-center justify-center tabular-nums leading-none">
      {count > 99 ? "99+" : count}
    </span>
  );
}
