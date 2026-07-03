"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { TriageBadge } from "@/components/triage/TriageBadge";

const NAV_ITEMS = [
  { href: "/", label: "Accueil", icon: "○" },
  { href: "/library", label: "Bibliothèque", icon: "◻" },
  { href: "/collections", label: "Collections", icon: "▣" },
  { href: "/moodboards", label: "Planches", icon: "⬚" },
  { href: "/visites", label: "Visites", icon: "◈" },
  { href: "/search", label: "Recherche", icon: "◎" },
  { href: "/upload",  label: "Ajouter",  icon: "+" },
  { href: "/triage",  label: "Triage",   icon: "⇄" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    // md (768–1279px) = tablet/iPad slim : icônes seules, w-14 (56px)
    //   → couvre portrait ET paysage sur tous les iPads (≤1194px)
    // xl (1280px+)    = desktop full : icônes + libellés, w-56 (224px)
    <aside className="hidden md:flex md:w-14 xl:w-56 flex-shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-base)]">
      {/* Logo */}
      <div className="h-14 flex items-center justify-center xl:justify-start xl:px-6 border-b border-[var(--border-subtle)]">
        <span className="text-[var(--text-primary)] font-medium text-sm xl:hidden opacity-40">M</span>
        <span className="hidden xl:block text-[var(--text-primary)] tracking-[0.15em] uppercase text-xs font-medium">
          Moodboard
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 space-y-0.5 px-2 xl:px-3">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                "flex items-center justify-center xl:justify-start gap-3 xl:px-3 py-2.5 rounded-md text-sm transition-colors relative group",
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
              {/* Icon — with superposed badge in icon-only mode (md, not xl) */}
              <span className="relative z-10 font-mono text-xs flex-shrink-0">
                {item.icon}
                {item.href === "/triage" && (
                  <span className="absolute -top-2 -right-2.5 xl:hidden pointer-events-none">
                    <TriageBadge />
                  </span>
                )}
              </span>
              <span className="relative z-10 hidden xl:block flex-1">{item.label}</span>
              {/* Badge inline on xl (full label visible) */}
              {item.href === "/triage" && (
                <span className="relative z-10 hidden xl:flex">
                  <TriageBadge />
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Settings */}
      <div className="px-2 xl:px-3 py-3 border-t border-[var(--border-subtle)]">
        <Link
          href="/settings"
          title="Réglages"
          className={cn(
            "flex items-center justify-center xl:justify-start gap-3 xl:px-3 py-2.5 rounded-md text-sm transition-colors relative",
            pathname.startsWith("/settings")
              ? "text-[var(--text-primary)] bg-[var(--bg-elevated)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          )}
        >
          <span className="font-mono text-xs opacity-50">⚙</span>
          <span className="hidden xl:block">Réglages</span>
        </Link>
      </div>
    </aside>
  );
}
