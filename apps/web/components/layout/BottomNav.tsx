"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Images, Layers, Plus, Inbox, Search, LayoutDashboard, Landmark, Settings, CircleUser, MoreHorizontal, Check, Users, MessageCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TriageBadge } from "@/components/triage/TriageBadge";
import { compressImageForUpload } from "@/lib/image/clientResize";

// 5 slots (4 items ici + le bouton "Plus" ajouté séparément dans le JSX) avec
// le "+" en position centrale (index 2 sur 5 : 2 items avant, Recherche +
// "Plus" après) — Collections déplacée vers "Plus" pour lui laisser sa place
// (demande utilisateur 2026-07-14, le "+" doit être visuellement centré).
const NAV_ITEMS: { href: string; label: string; icon: LucideIcon; primary?: boolean }[] = [
  { href: "/library",     label: "Biblio",      icon: Images },
  { href: "/triage",      label: "Triage",      icon: Inbox },
  { href: "/upload",      label: "Ajouter",     icon: Plus, primary: true },
  { href: "/search",      label: "Recherche",   icon: Search },
];

// Destinations secondaires — accessibles via le bouton "Plus"
const MORE_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/collections",     label: "Collections", icon: Layers },
  { href: "/moodboards",      label: "Planches", icon: LayoutDashboard },
  { href: "/visites",         label: "Visites",  icon: Landmark },
  { href: "/reseau",          label: "Réseau",   icon: Users },
  { href: "/messages",        label: "Messagerie", icon: MessageCircle },
  { href: "/settings/categories", label: "Réglages", icon: Settings },
  { href: "/settings/account", label: "Compte",   icon: CircleUser },
];

const LONG_PRESS_MS = 450;

type CaptureState = "idle" | "uploading" | "done" | "error";

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  // ── Appui long sur "+" → appareil photo direct (capture d'inspiration "sur
  // le vif", sans quitter la page courante) — même esprit "friction zéro" que
  // le FAB de capture des visites, mais SANS visite à rattacher : la photo
  // rejoint directement la bibliothèque de triage. Un tap court garde le
  // comportement existant (navigation vers /upload). ──
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const [capture, setCapture] = useState<CaptureState>("idle");
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
  }, []);

  // Auto-effacement du statut "envoyée" / de l'erreur.
  useEffect(() => {
    if (capture !== "done" && capture !== "error") return;
    const t = window.setTimeout(() => { setCapture("idle"); setCaptureError(null); }, capture === "error" ? 3500 : 1600);
    return () => window.clearTimeout(t);
  }, [capture]);

  const onPlusPointerDown = () => {
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      navigator.vibrate?.(15);
      setMoreOpen(false);
      cameraInputRef.current?.click();
    }, LONG_PRESS_MS);
  };
  const onPlusPointerUpOrLeave = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
  };
  // Empêche la navigation vers /upload si l'appui long a déjà déclenché la
  // caméra — sinon un simple relâchement de doigt après le seuil ouvrirait
  // AUSSI la page /upload en plus de l'appareil photo.
  const onPlusClick = (e: React.MouseEvent) => {
    if (longPressFired.current) { e.preventDefault(); return; }
    setMoreOpen(false);
  };

  const handleCameraCapture = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setCapture("uploading");
    setCaptureError(null);
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        throw new Error("Hors ligne — réessaie une fois connecté.");
      }
      const compressed = await compressImageForUpload(file);
      const fd = new FormData();
      fd.append("file", compressed);
      const res = await fetch("/api/upload/image", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Échec de l'envoi");
      setCapture("done");
      // La bibliothèque/le triage peuvent déjà être affichés dans un autre
      // onglet ou après un retour en arrière — un refresh discret les tient
      // à jour sans forcer de navigation (capture "sur le vif" = on ne quitte
      // pas la page courante).
      router.refresh();
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : "Échec de l'envoi");
      setCapture("error");
    } finally {
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  // Le bouton "Plus" est actif si on est sur une de ses destinations
  const moreActive = MORE_ITEMS.some((item) => pathname.startsWith(item.href));

  return (
    <>
      {/* Appareil photo natif — pas de galerie ici (capture="environment"
          force la prise de vue), déclenché uniquement par l'appui long. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleCameraCapture(e.target.files)}
      />

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
                      <item.icon size={18} strokeWidth={1.75} className="opacity-80" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Toast capture caméra (erreur / confirmation) */}
      {(capture === "error" || capture === "done") && (
        <div className="fixed inset-x-4 z-[65] bottom-16 md:hidden">
          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-xs shadow-xl flex items-center gap-2",
              capture === "error"
                ? "bg-[var(--bg-elevated)] border-red-500/30 text-red-400"
                : "bg-[var(--bg-elevated)] border-[var(--border-default)] text-[var(--text-secondary)]"
            )}
          >
            {capture === "done" ? (
              <span className="inline-flex items-center gap-1.5"><Check size={13} strokeWidth={2.5} className="text-[var(--accent,#a78bfa)]" /> Photo ajoutée — à trier</span>
            ) : (
              <span className="flex-1">{captureError}</span>
            )}
          </div>
        </div>
      )}

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
                  onPointerDown={onPlusPointerDown}
                  onPointerUp={onPlusPointerUpOrLeave}
                  onPointerLeave={onPlusPointerUpOrLeave}
                  onPointerCancel={onPlusPointerUpOrLeave}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={onPlusClick}
                  title="Ajouter (appui long : appareil photo)"
                  className="flex-1 flex items-center justify-center select-none"
                  style={{ WebkitTouchCallout: "none" }}
                >
                  <span
                    className={cn(
                      "w-9 h-9 rounded-full flex items-center justify-center transition-colors border",
                      isActive
                        ? "bg-[var(--text-primary)] text-[var(--bg-base)] border-transparent"
                        : "border-[var(--border-default)] text-[var(--text-secondary)]",
                      capture === "uploading" && "opacity-70"
                    )}
                  >
                    {capture === "uploading" ? (
                      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <item.icon size={20} strokeWidth={2} />
                    )}
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
                <span className="relative leading-none">
                  <item.icon size={20} strokeWidth={1.75} />
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
            <span className="leading-none"><MoreHorizontal size={20} strokeWidth={1.75} /></span>
            <span className="text-[9px] tracking-wide leading-none">Plus</span>
          </button>
        </div>
      </nav>
    </>
  );
}
