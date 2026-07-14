"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { getImageUrl } from "@/lib/storage/urls";

export interface CoverImage {
  id: string;
  storageKey: string;
  width: number | null;
  height: number | null;
}

const AUTOPLAY_INTERVAL_MS = 4500;
const RESUME_AFTER_INTERACTION_MS = 6000;

// Couverture façon Apple Journal : bandeau plein-large en tête de visite, les
// images de la visite défilent en carrousel (au lieu d'un simple titre
// statique), avec le nom de l'exposition affiché en grand par-dessus — la
// vraie "couverture premium" demandée, pas juste un slideshow anonyme.
// Pleine résolution (getImageUrl, pas thumbnail) car c'est la pièce hero.
// `backHref` : bouton retour rond flottant sur la cover (façon Journal).
export function VisitCoverCarousel({
  images,
  title,
  backHref,
  children,
  topRight,
  className,
}: {
  images: CoverImage[];
  /** Titre affiché en grand sur la cover — exposition, ou lieu à défaut.
   *  Ignoré si `children` est fourni (overlay d'infos personnalisé). */
  title?: string;
  backHref?: string;
  /** Overlay d'infos en bas de la cover (ex. en-tête éditable) — remplace le
   *  titre statique. */
  children?: React.ReactNode;
  /** Slot en haut à droite de la cover (ex. bouton Partager). */
  topRight?: React.ReactNode;
  /** Override des marges racine (ex. tuck sous une barre sticky). */
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Le scroll déclenché par l'autoplay ne doit pas être interprété comme une
  // "interaction utilisateur" qui mettrait l'autoplay en pause lui-même.
  const programmaticRef = useRef(false);
  // Ref miroir pour lire l'index courant depuis le setInterval sans le
  // recréer à chaque changement (évite un autoplay qui repart de zéro).
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || images.length <= 1) return;
    const onScroll = () => {
      const index = Math.round(scroller.scrollLeft / scroller.clientWidth);
      setActiveIndex(Math.min(images.length - 1, Math.max(0, index)));
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [images.length]);

  // Défilement automatique — en boucle, mis en pause pendant et juste après
  // une interaction manuelle (swipe/scroll) pour ne pas lutter contre le doigt.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || images.length <= 1) return;

    let timer: number | null = null;
    let resumeTimeout: number | null = null;

    const advance = () => {
      const next = (activeIndexRef.current + 1) % images.length;
      programmaticRef.current = true;
      scroller.scrollTo({ left: next * scroller.clientWidth, behavior: "smooth" });
      window.setTimeout(() => { programmaticRef.current = false; }, 500);
    };
    const start = () => { timer = window.setInterval(advance, AUTOPLAY_INTERVAL_MS); };
    const stop = () => { if (timer) { window.clearInterval(timer); timer = null; } };

    const onInteractionStart = () => {
      if (programmaticRef.current) return;
      stop();
      if (resumeTimeout) window.clearTimeout(resumeTimeout);
      resumeTimeout = window.setTimeout(start, RESUME_AFTER_INTERACTION_MS);
    };

    start();
    scroller.addEventListener("pointerdown", onInteractionStart);
    return () => {
      stop();
      if (resumeTimeout) window.clearTimeout(resumeTimeout);
      scroller.removeEventListener("pointerdown", onInteractionStart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length]);

  if (images.length === 0) return null;

  return (
    // Détachée des bords + coins arrondis + halo lumineux (retour utilisateur
    // 2026-07-14) — a remplacé le bandeau plein-large "Apple Journal"
    // d'origine (voir ancien commit) : hauteur réduite d'1/4 (h-[38/46vh] →
    // h-[29/35vh]), marge haute au lieu du tuck sous la barre sticky.
    <div className={cn("relative mt-2 md:mt-3 mb-5 h-[29vh] md:h-[35vh]", className)}>
      {/* Halo lumineux : version floutée de l'image active posée DERRIÈRE la
          carte, débordant largement au-delà de ses bords (façon "ambient
          light" Apple TV/Google AI Studio) — un calque par image, crossfade
          en opacité sur `activeIndex` pour "réagir" au défilement.
          Deuxième essai encore trop discret : le masque radial (55%→100%)
          finissait de s'estomper bien AVANT le bord de la carte (qui occupe
          ~55-80% du rayon de la zone de halo selon l'axe) — la portion
          réellement visible (au-delà de la carte) ne montrait donc que la
          toute fin, quasi transparente, du dégradé. Recalé pour que le
          dégradé COMMENCE juste avant le bord de la carte, pas avant : la
          lueur reste vive tout du long de l'anneau visible et ne s'éteint
          que sur la toute fin, près du bord externe de la zone. */}
      <div className="pointer-events-none absolute -inset-8 md:-inset-24 -z-10">
        {images.map((img, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={img.id}
            src={getImageUrl(img.storageKey)}
            alt=""
            aria-hidden
            className={cn(
              "absolute inset-0 h-full w-full object-cover blur-[40px] md:blur-[56px] saturate-[2] brightness-115 transition-opacity duration-700",
              i === activeIndex ? "opacity-100" : "opacity-0"
            )}
            style={{
              maskImage: "radial-gradient(closest-side, black 72%, transparent 100%)",
              WebkitMaskImage: "radial-gradient(closest-side, black 72%, transparent 100%)",
            }}
          />
        ))}
      </div>

      {/* Carte nette : image, dégradés, infos — clip + coins arrondis */}
      <div className="relative h-full w-full overflow-hidden rounded-2xl">
        <div
          ref={scrollerRef}
          className="h-full w-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth"
          style={{ scrollbarWidth: "none" }}
        >
          {images.map((img) => (
            <div key={img.id} className="h-full w-full flex-shrink-0 snap-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getImageUrl(img.storageKey)}
                alt=""
                loading={img.id === images[0].id ? "eager" : "lazy"}
                className="h-full w-full object-cover"
              />
            </div>
          ))}
        </div>

        {/* Retour flottant façon Journal — visible sans scroller, par-dessus la photo */}
        {backHref && (
          <Link
            href={backHref}
            className="absolute top-3 left-3 md:top-4 md:left-4 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-black/50 backdrop-blur-sm text-white/90 hover:bg-black/70 transition-colors"
            title="Retour au carnet de visite"
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </Link>
        )}

        {/* Slot haut-droite (ex. bouton Partager) */}
        {topRight && <div className="absolute top-3 right-3 md:top-4 md:right-4 z-10">{topRight}</div>}

        {/* Dégradé de lisibilité (haut + bas), plus prononcé qu'avant — et
            infos en grand par-dessus, cover "premium". */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/95 via-black/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-8 px-5 md:px-8">
          {children ?? (
            <h1
              className="pointer-events-none text-white font-light text-3xl md:text-5xl leading-[1.05] tracking-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]"
              style={{ textWrap: "balance" }}
            >
              {title}
            </h1>
          )}
        </div>

        {images.length > 1 && (
          <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-1.5">
            {images.map((img, i) => (
              <span
                key={img.id}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === activeIndex ? "w-4 bg-white" : "w-1.5 bg-white/40"
                )}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
