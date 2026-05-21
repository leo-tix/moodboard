"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Accueil", icon: "○" },
  { href: "/library", label: "Bibliothèque", icon: "◻" },
  { href: "/collections", label: "Collections", icon: "▣" },
  { href: "/search", label: "Recherche", icon: "◎" },
  { href: "/upload", label: "Ajouter", icon: "+" },
  { href: "/import/youtube", label: "YouTube", icon: "▶" },
];

export function Sidebar() {
  const pathname = usePathname();

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
              <span className="relative z-10 font-mono text-xs opacity-60">{item.icon}</span>
              <span className="relative z-10">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Settings */}
      <div className="px-3 py-4 border-t border-[var(--border-subtle)]">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors relative",
            pathname.startsWith("/settings")
              ? "text-[var(--text-primary)] bg-[var(--bg-elevated)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          )}
        >
          <span className="font-mono text-xs opacity-60">⚙</span>
          <span>Réglages</span>
        </Link>
      </div>
    </aside>
  );
}
