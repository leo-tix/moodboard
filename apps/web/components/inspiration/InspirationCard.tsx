"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";

interface InspirationCardProps {
  id: string;
  title: string;
  thumbnailKey: string | null;
  blurHash: string | null;
  width: number | null;
  height: number | null;
  category?: string | null;
  tags?: string[];
  year?: number | null;
  className?: string;
}

export function InspirationCard({
  id,
  title,
  thumbnailKey,
  blurHash,
  width,
  height,
  category,
  tags = [],
  year,
  className,
}: InspirationCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const thumbUrl = thumbnailKey ? getThumbnailUrl(thumbnailKey) : null;
  const aspectRatio = width && height ? width / height : 1;

  return (
    <Link href={`/library/${id}`} className={cn("block group", className)}>
      <motion.div
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        className="relative overflow-hidden rounded-md bg-[var(--bg-surface)] cursor-pointer"
        style={{ aspectRatio }}
        whileHover={{ scale: 1.005 }}
        transition={{ duration: 0.2 }}
      >
        {/* Placeholder couleur / blur pendant le chargement */}
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-500",
            loaded ? "opacity-0" : "opacity-100"
          )}
          style={{ backgroundColor: "var(--bg-elevated)" }}
        />

        {/* Image */}
        {thumbUrl ? (
          <Image
            src={thumbUrl}
            alt={title}
            fill
            className={cn(
              "object-cover transition-all duration-500",
              loaded ? "opacity-100" : "opacity-0",
              hovered ? "scale-[1.02]" : "scale-100"
            )}
            onLoad={() => setLoaded(true)}
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
          />
        ) : (
          // Placeholder si pas d'image
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[var(--text-tertiary)] text-xs">Sans image</span>
          </div>
        )}

        {/* Overlay hover — infos */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: hovered ? 1 : 0 }}
          transition={{ duration: 0.18 }}
        >
          <p className="text-white text-xs font-medium leading-tight line-clamp-2 mb-1.5">
            {title}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {category && (
              <span className="text-[10px] text-white/60">{category}</span>
            )}
            {year && (
              <span className="text-[10px] text-white/40">{year}</span>
            )}
          </div>
          {tags.length > 0 && (
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] px-1.5 py-0.5 bg-white/10 text-white/70 rounded-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </motion.div>
      </motion.div>
    </Link>
  );
}
