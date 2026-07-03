"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { TriageBadge } from "@/components/triage/TriageBadge";

const NAV_ITEMS = [
  { href: "/library",     label: "Biblio",      icon: "◻" },
  { href: "/collections", label: "Collections", icon: "▣" },
  { href: "/upload",      label: "Ajouter",     icon: "+", primary: true },
  { href: "/triage",      label: "Triage",      icon: "⇄" },
  { href: "/search",      label: "Recherche",   icon: "◎" },
];

// Destinations secondaires — accessibles via le bouton "Plus"
const MORE_ITEMS = [
  { href: "/moodboards", label: "Planches", icon: "⬚" },
  { href: "/visites",    label: "Visites",  icon: "◈" },
  { href: "/settings",   label: "Réglages", icon: "⚙" },
];

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Le bouton "Plus" est actif si on est sur une de ses destinations
  const moreActive = MORE_ITEMS.some((item) => pathname.startsWith(item.href));

  return (
    <>
      {/* Bottom sheet "Plus" */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setMoreOpen(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", bounce: 0, duration: 0.28 }}
              className="fixed bottom-0 inset-x-0 z-50 md:hidden bg-[var(--bg-base)] border-t border-[var(--border-subtle)] rounded-t-2xl"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 64px)" }}
            >
              <div className="flex justify-center pt-2.5 pb-1">
                <div className="w-8 h-1 rounded-full bg-[var(--border-default)]" />
              </div>
              <nav className="px-4 py-2">
                {MORE_ITEMS.map((item) => {
                  const isActive = pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors",
                        isActive
                          ? "text-[var(--text-primary)] bg-[var(--bg-elevated)]"
                          : "text-[var(--text-secondary)] active:bg-[var(--bg-elevated)]"
                      )}
                    >
                      <span className="font-mono text-xs opacity-60 w-4 text-center">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <nav
        className="fixed bottom-0 inset-x-0 z-[60] md:hidden bg-[var(--bg-base)]/95 backdrop-blur-md border-t border-[var(--border-subtle)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-stretch h-14">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            if (item.primary) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="flex-1 flex items-center justify-center"
                >
                  <span
                    className={cn(
                      "w-9 h-9 rounded-full flex items-center justify-center text-base transition-colors border",
                      isActive
                        ? "bg-[var(--text-primary)] text-[var(--bg-base)] border-transparent"
                        : "border-[var(--border-default)] text-[var(--text-secondary)]"
                    )}
                  >
                    +
                  </span>
                </Link>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-1 transition-colors",
                  isActive && !moreOpen
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-tertiary)]"
                )}
              >
                <span className="relative font-mono text-[11px] leading-none">
                  {item.icon}
                  {item.href === "/triage" && (
                    <span className="absolute -top-2 -right-2.5 pointer-events-none">
                      <TriageBadge />
                    </span>
                  )}
                </span>
                <span className="text-[9px] tracking-wide leading-none">{item.label}</span>
              </Link>
            );
          })}

          {/* Bouton "Plus" — Planches / Visites / Réglages */}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-1 transition-colors",
              moreOpen || moreActive
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-tertiary)]"
            )}
          >
            <span className="font-mono text-[11px] leading-none">⋯</span>
            <span className="text-[9px] tracking-wide leading-none">Plus</span>
          </button>
        </div>
      </nav>
    </>
  );
}
