"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SETTINGS_NAV = [
  { href: "/settings/account", label: "Compte" },
  { href: "/settings/general", label: "Général" },
  { href: "/settings/categories", label: "Catégories" },
  { href: "/settings/extensions", label: "Extensions" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Desktop : sidebar verticale ; Mobile : onglets horizontaux scrollables */}
      <aside className="md:w-48 flex-shrink-0 md:border-r border-b md:border-b-0 border-[var(--border-subtle)] md:py-6 md:px-3">
        <p className="hidden md:block px-3 text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mb-3">
          Réglages
        </p>
        <nav className="flex md:flex-col gap-0.5 overflow-x-auto scrollbar-none px-2 py-2 md:px-0 md:py-0">
          {SETTINGS_NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex-shrink-0 px-3 py-2 text-sm rounded-md transition-colors whitespace-nowrap",
                  active
                    ? "text-[var(--text-primary)] bg-[var(--bg-elevated)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
