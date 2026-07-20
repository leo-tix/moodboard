import type { CanvasElement } from "@/lib/moodboard/types";
import { getImageUrl, getThumbnailUrl } from "@/lib/storage/urls";

// Vignette statique d'une planche (rendu fidèle en miniature). Sans interactivité
// → utilisable côté serveur (feed, aperçus de message) comme client (grille).
// `canvasData` doit être pré-réduit (capCanvasForPreview) pour éviter 100+ <img>.
export function MoodboardPreview({ canvasData, background }: { canvasData: CanvasElement[]; background: string }) {
  if (canvasData.length === 0) {
    return (
      <div className="aspect-video w-full flex items-center justify-center" style={{ backgroundColor: background }}>
        <span className="text-[var(--text-tertiary)] text-xs opacity-40">Planche vide</span>
      </div>
    );
  }

  const minX = Math.min(...canvasData.map((e) => e.x));
  const minY = Math.min(...canvasData.map((e) => e.y));
  const maxX = Math.max(...canvasData.map((e) => e.x + e.w));
  const maxY = Math.max(...canvasData.map((e) => e.y + e.h));
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);

  const VIRT_W = 16;
  const VIRT_H = 9;
  const PAD = 0.55;
  const scale = Math.min((VIRT_W - PAD * 2) / bw, (VIRT_H - PAD * 2) / bh);
  const offsetX = (VIRT_W - bw * scale) / 2;
  const offsetY = (VIRT_H - bh * scale) / 2;

  const sorted = [...canvasData].sort((a, b) => {
    const az = a.type === "sticky" ? a.zIndex + 100000 : a.zIndex;
    const bz = b.type === "sticky" ? b.zIndex + 100000 : b.zIndex;
    return az - bz;
  });

  return (
    <div className="aspect-video w-full relative overflow-hidden" style={{ backgroundColor: background }}>
      {sorted.map((el) => {
        const vx = (el.x - minX) * scale + offsetX;
        const vy = (el.y - minY) * scale + offsetY;
        const vw = el.w * scale;
        const vh = el.h * scale;
        const baseStyle: React.CSSProperties = {
          position: "absolute",
          left: `${(vx / VIRT_W) * 100}%`,
          top: `${(vy / VIRT_H) * 100}%`,
          width: `${(vw / VIRT_W) * 100}%`,
          height: `${(vh / VIRT_H) * 100}%`,
          opacity: el.opacity ?? 1,
          borderRadius: 3,
          overflow: "hidden",
        };

        if (el.type === "image") {
          const previewSrc = el.thumbnailKey ? getThumbnailUrl(el.thumbnailKey) : getImageUrl(el.storageKey);
          return (
            <div key={el.id} style={baseStyle}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewSrc} alt="" loading="lazy" decoding="async" draggable={false} style={{ width: "100%", height: "100%", objectFit: el.objectFit ?? "cover", display: "block" }} />
            </div>
          );
        }
        if (el.type === "color") return <div key={el.id} style={{ ...baseStyle, backgroundColor: el.color }} />;
        if (el.type === "sticky") return <div key={el.id} style={{ ...baseStyle, backgroundColor: el.backgroundColor }} />;
        if (el.type === "text") return <div key={el.id} style={{ ...baseStyle, backgroundColor: `${el.color}26` }} />;
        return null;
      })}
    </div>
  );
}
