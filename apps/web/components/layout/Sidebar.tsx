"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useRef } from "react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Accueil", icon: "○" },
  { href: "/library", label: "Bibliothèque", icon: "◻" },
  { href: "/collections", label: "Collections", icon: "◈" },
  { href: "/upload", label: "Ajouter", icon: "+" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchRef.current?.value.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-base)]">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-[var(--border-subtle)]">
        <span className="text-[var(--text-primary)] tracking-[0.15em] uppercase text-xs font-medium">
          Moodboard
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors relative group",
                isActive
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-[var(--bg-elevated)] rounded-md"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
              <span className="relative z-10 font-mono text-xs opacity-60">
                {item.icon}
              </span>
              <span className="relative z-10">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Recherche rapide */}
      <div className="px-3 pb-2">
        <form onSubmit={handleSearchSubmit}>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] text-[10px] pointer-events-none">◎</span>
            <input
              ref={searchRef}
              type="search"
              placeholder="Rechercher…"
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] rounded-md pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:border-[var(--border-default)] transition-colors"
            />
          </div>
        </form>
      </div>

      {/* Settings bas */}
      <div className="px-3 py-4 border-t border-[var(--border-subtle)]">
        <Link
          href="/settings"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <span className="font-mono text-xs opacity-60">⚙</span>
          <span>Réglages</span>
        </Link>
      </div>
    </aside>
  );
}
