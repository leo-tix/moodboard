"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Home, Images, Layers, LayoutDashboard, Landmark, Search, Plus, Inbox, Settings, Users, MessageCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getImageUrl } from "@/lib/storage/urls";
import { TriageBadge } from "@/components/triage/TriageBadge";

interface SidebarUser {
  name: string | null;
  email: string;
  image: string | null;
}

function initialsOf(name: string | null, email: string): string {
  const base = (name ?? "").trim() || email;
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Accueil", icon: Home },
  { href: "/library", label: "Bibliothèque", icon: Images },
  { href: "/collections", label: "Collections", icon: Layers },
  { href: "/moodboards", label: "Planches", icon: LayoutDashboard },
  { href: "/visites", label: "Visites", icon: Landmark },
  { href: "/reseau", label: "Réseau", icon: Users },
  { href: "/messages", label: "Messagerie", icon: MessageCircle },
  { href: "/search", label: "Recherche", icon: Search },
  { href: "/upload",  label: "Ajouter",  icon: Plus },
  { href: "/triage",  label: "Triage",   icon: Inbox },
];

export function Sidebar({ user }: { user: SidebarUser }) {
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
              <span className="relative z-10 flex-shrink-0">
                <item.icon size={18} strokeWidth={1.75} />
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

      {/* Settings + compte */}
      <div className="px-2 xl:px-3 py-3 border-t border-[var(--border-subtle)] space-y-0.5">
        <Link
          href="/settings/categories"
          title="Réglages"
          className={cn(
            "flex items-center justify-center xl:justify-start gap-3 xl:px-3 py-2.5 rounded-md text-sm transition-colors relative",
            (pathname === "/settings" || pathname.startsWith("/settings/")) && !pathname.startsWith("/settings/account")
              ? "text-[var(--text-primary)] bg-[var(--bg-elevated)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          )}
        >
          <Settings size={18} strokeWidth={1.75} className="opacity-70" />
          <span className="hidden xl:block">Réglages</span>
        </Link>

        {/* Compte — avatar + nom, mène aux réglages du compte */}
        <Link
          href="/settings/account"
          title="Compte"
          className={cn(
            "flex items-center justify-center xl:justify-start gap-2.5 xl:px-2 py-1.5 rounded-md transition-colors",
            pathname.startsWith("/settings/account")
              ? "bg-[var(--bg-elevated)]"
              : "hover:bg-[var(--bg-elevated)]"
          )}
        >
          <span className="w-7 h-7 rounded-full overflow-hidden bg-[var(--bg-elevated)] border border-[var(--border-default)] flex items-center justify-center flex-shrink-0">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={getImageUrl(user.image)} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                {initialsOf(user.name, user.email)}
              </span>
            )}
          </span>
          <span className="hidden xl:block min-w-0">
            <span className="block text-xs text-[var(--text-primary)] truncate">
              {user.name || "Mon compte"}
            </span>
            <span className="block text-[10px] text-[var(--text-tertiary)] truncate">
              {user.email}
            </span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
