"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const BASE_NAV = [
  { href: "/settings/account", label: "Compte" },
  { href: "/settings/categories", label: "Catégories" },
  { href: "/settings/extensions", label: "Extensions" },
];

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  // "Profils" et "Import vidéo" réservés à l'admin (comptes/quota, cookies yt-dlp)
  const nav = isAdmin
    ? [
        ...BASE_NAV,
        { href: "/settings/profiles", label: "Profils" },
        { href: "/settings/video-import", label: "Import vidéo" },
      ]
    : BASE_NAV;

  return (
    <nav className="flex md:flex-col gap-0.5 overflow-x-auto scrollbar-none px-2 py-2 md:px-0 md:py-0">
      {nav.map((item) => {
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
  );
}
