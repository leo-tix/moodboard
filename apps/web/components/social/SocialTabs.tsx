"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Newspaper, MessageCircle, Users, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { SocialBadge } from "@/components/social/SocialBadge";
import { NotificationsBadge } from "@/components/social/NotificationsBadge";

// En-tête d'onglets partagé par les 4 surfaces sociales (Fil / Messagerie /
// Réseau / Notifications) → une seule « page » sociale à onglets.
const TABS: { href: string; label: string; icon: typeof Newspaper; badge?: "requests" | "messages" | "notifs" }[] = [
  { href: "/feed", label: "Fil", icon: Newspaper },
  { href: "/messages", label: "Messagerie", icon: MessageCircle, badge: "messages" },
  { href: "/reseau", label: "Réseau", icon: Users, badge: "requests" },
  { href: "/notifications", label: "Activité", icon: Bell, badge: "notifs" },
];

export function SocialTabs() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] mb-5">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors",
              active ? "border-[var(--text-primary)] text-[var(--text-primary)] font-medium" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}
          >
            <t.icon size={15} strokeWidth={1.9} /> {t.label}
            {t.badge === "notifs" ? <NotificationsBadge /> : t.badge && <SocialBadge kind={t.badge} />}
          </Link>
        );
      })}
    </div>
  );
}
