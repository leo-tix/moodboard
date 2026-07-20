import Link from "next/link";
import { cn } from "@/lib/utils";

// Onglets « Mes X » / « Partagé avec moi » en tête des pages Planches / Visites /
// Collections. Piloté par l'URL (?tab=shared) — les clients « mes ressources »
// existants restent inchangés, on bascule côté serveur sur une grille dédiée.
export function LibraryTabs({ base, active, mineLabel, sharedCount }: { base: string; active: "mine" | "shared"; mineLabel: string; sharedCount: number }) {
  const pill = (on: boolean) =>
    cn(
      "px-3.5 py-1.5 rounded-full text-sm transition-colors border",
      on
        ? "bg-[var(--text-primary)] text-[var(--bg-base)] border-transparent"
        : "text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]",
    );
  return (
    <div className="flex items-center gap-2 mb-5">
      <Link href={base} className={pill(active === "mine")}>{mineLabel}</Link>
      <Link href={`${base}?tab=shared`} className={cn(pill(active === "shared"), "inline-flex items-center gap-1.5")}>
        Partagé avec moi
        {sharedCount > 0 && (
          <span className={cn("text-[10px] rounded-full px-1.5 py-0.5", active === "shared" ? "bg-[var(--bg-base)]/20" : "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]")}>{sharedCount}</span>
        )}
      </Link>
    </div>
  );
}
