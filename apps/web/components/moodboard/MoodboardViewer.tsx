"use client";

import Image from "next/image";
import { useState } from "react";
import { getImageUrl } from "@/lib/storage/urls";
import type {
  CanvasElement,
  ImageElement,
  TextElement,
  ColorElement,
  StickyElement,
} from "@/lib/moodboard/types";

interface Props {
  data: {
    id: string;
    title: string;
    canvasData: CanvasElement[];
    background: string;
  };
}

const GRID_PX = 24;

export function MoodboardViewer({ data }: Props) {
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [zoom, setZoom] = useState(1);

  // Basic zoom controls for public viewer
  const zoomIn = () => setZoom((z) => Math.min(5, z * 1.25));
  const zoomOut = () => setZoom((z) => Math.max(0.1, z * 0.8));
  const reset = () => { setZoom(1); setPan({ x: 40, y: 40 }); };

  const gridSize = GRID_PX * zoom;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex-shrink-0 h-11 border-b border-[var(--border-subtle)] flex items-center px-4 gap-3">
        <p className="text-sm text-[var(--text-primary)]">{data.title}</p>
        <span className="text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded">
          Lecture seule
        </span>
        <div className="flex-1" />
        {/* Zoom */}
        <div className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
          <button onClick={zoomOut} className="w-6 h-6 hover:text-[var(--text-primary)] flex items-center justify-center">−</button>
          <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} className="w-6 h-6 hover:text-[var(--text-primary)] flex items-center justify-center">+</button>
          <button onClick={reset} className="px-1 hover:text-[var(--text-primary)]">↺</button>
        </div>
      </div>

      {/* Canvas */}
      <div
        className="flex-1 relative overflow-hidden"
        style={{
          backgroundColor: data.background,
          backgroundImage: `radial-gradient(circle, rgba(128,128,148,0.18) 1px, transparent 1px)`,
          backgroundSize: `${gridSize}px ${gridSize}px`,
          backgroundPosition: `${pan.x % gridSize}px ${pan.y % gridSize}px`,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            width: 0,
            height: 0,
          }}
        >
          {data.canvasData.map((el) => (
            <div
              key={el.id}
              className="absolute"
              style={{
                left: el.x,
                top: el.y,
                width: el.w,
                height: el.h,
                zIndex: el.zIndex,
                opacity: el.opacity ?? 1,
              }}
            >
              <ViewerElement element={el} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ViewerElement({ element }: { element: CanvasElement }) {
  const br = 8;

  if (element.type === "image") {
    const el = element as ImageElement;
    const fit = el.objectFit ?? "cover";
    const url = getImageUrl(el.storageKey);
    return (
      <div className="w-full h-full overflow-hidden relative" style={{ borderRadius: br }}>
        {el.isAnimated ? (
          <img
            src={url}
            alt={el.title}
            draggable={false}
            className={`absolute inset-0 w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
          />
        ) : (
          <Image
            src={url}
            alt={el.title}
            fill
            className={fit === "contain" ? "object-contain" : "object-cover"}
            sizes="600px"
            draggable={false}
          />
        )}
      </div>
    );
  }

  if (element.type === "text") {
    const el = element as TextElement;
    return (
      <div
        className="w-full h-full flex items-start p-1.5 break-words"
        style={{
          fontSize: el.fontSize,
          color: el.color,
          fontWeight: el.bold ? "bold" : "normal",
          fontStyle: el.italic ? "italic" : "normal",
          lineHeight: 1.4,
          borderRadius: br,
        }}
      >
        {el.content}
      </div>
    );
  }

  if (element.type === "color") {
    const el = element as ColorElement;
    return (
      <div
        className="w-full h-full"
        style={{ backgroundColor: el.color, borderRadius: br }}
      />
    );
  }

  if (element.type === "sticky") {
    const el = element as StickyElement;
    return (
      <div
        className="w-full h-full flex flex-col p-3"
        style={{
          backgroundColor: el.backgroundColor,
          borderRadius: br,
          boxShadow: "2px 3px 8px rgba(0,0,0,0.2)",
        }}
      >
        <p
          className="text-sm leading-relaxed break-words"
          style={{ color: el.textColor }}
        >
          {el.content}
        </p>
      </div>
    );
  }

  return null;
}
