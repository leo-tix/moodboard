"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Accueil", icon: "○" },
  { href: "/library", label: "Bibliothèque", icon: "◻" },
  { href: "/collections", label: "Collections", icon: "▣" },
  { href: "/moodboards", label: "Planches", icon: "⬚" },
  { href: "/search", label: "Recherche", icon: "◎" },
  { href: "/upload", label: "Ajouter", icon: "+" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    // md (768–1024px) = tablet slim : icônes seules, w-14 (56px)
    // lg (1024px+)    = desktop full : icônes + libellés, w-56 (224px)
    <aside className="hidden md:flex md:w-14 lg:w-56 flex-shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-base)]">
      {/* Logo */}
      <div className="h-14 flex items-center justify-center lg:justify-start lg:px-6 border-b border-[var(--border-subtle)]">
        {/* Abrégé sur tablet, complet sur desktop */}
        <span className="text-[var(--text-primary)] font-medium text-sm lg:hidden opacity-40">M</span>
        <span className="hidden lg:block text-[var(--text-primary)] tracking-[0.15em] uppercase text-xs font-medium">
          Moodboard
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 space-y-0.5 px-2 lg:px-3">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}           // tooltip natif en mode slim
              className={cn(
                "flex items-center justify-center lg:justify-start gap-3 lg:px-3 py-2.5 rounded-md text-sm transition-colors relative group",
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
              <span className="relative z-10 font-mono text-xs">{item.icon}</span>
              {/* Libellé masqué sur tablet */}
              <span className="relative z-10 hidden lg:block">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Settings */}
      <div className="px-2 lg:px-3 py-3 border-t border-[var(--border-subtle)]">
        <Link
          href="/settings"
          title="Réglages"
          className={cn(
            "flex items-center justify-center lg:justify-start gap-3 lg:px-3 py-2.5 rounded-md text-sm transition-colors relative",
            pathname.startsWith("/settings")
              ? "text-[var(--text-primary)] bg-[var(--bg-elevated)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          )}
        >
          <span className="font-mono text-xs opacity-50">⚙</span>
          <span className="hidden lg:block">Réglages</span>
        </Link>
      </div>
    </aside>
  );
}
