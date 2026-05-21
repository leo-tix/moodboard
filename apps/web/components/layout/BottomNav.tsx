"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/",            label: "Accueil",  icon: "○" },
  { href: "/library",     label: "Biblio",   icon: "◻" },
  { href: "/upload",      label: "Ajouter",  icon: "+" , primary: true },
  { href: "/moodboards",  label: "Planches", icon: "⬚" },
  { href: "/collections", label: "Collections", icon: "▣" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-[var(--bg-base)]/95 backdrop-blur-md border-t border-[var(--border-subtle)]"
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
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 transition-colors",
                isActive
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)]"
              )}
            >
              <span className="font-mono text-[11px] leading-none">{item.icon}</span>
              <span className="text-[9px] tracking-wide leading-none">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
