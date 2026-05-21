"use client";

import Image from "next/image";
import { getImageUrl } from "@/lib/storage/urls";
import type { CanvasElement } from "@/lib/moodboard/types";

interface Props {
  data: {
    id: string;
    title: string;
    canvasData: CanvasElement[];
    background: string;
  };
}

export function MoodboardViewer({ data }: Props) {
  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex-shrink-0 h-11 border-b border-[var(--border-subtle)] flex items-center px-4 gap-3">
        <p className="text-sm text-[var(--text-primary)]">{data.title}</p>
        <span className="text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded">Lecture seule</span>
      </div>

      {/* Canvas — read only */}
      <div className="flex-1 overflow-auto" style={{ backgroundColor: "var(--bg-surface)" }}>
        <div
          className="relative"
          style={{ width: 1600, height: 1000, backgroundColor: data.background }}
        >
          {data.canvasData.map((el) => (
            <div
              key={el.id}
              className="absolute"
              style={{ left: el.x, top: el.y, width: el.w, height: el.h, zIndex: el.zIndex }}
            >
              {el.type === "image" && (
                <div className="w-full h-full overflow-hidden rounded-sm relative">
                  <Image
                    src={getImageUrl(el.storageKey)}
                    alt={el.title}
                    fill
                    className="object-cover"
                    sizes="400px"
                  />
                </div>
              )}
              {el.type === "text" && (
                <div
                  className="w-full h-full flex items-start p-1 break-words"
                  style={{
                    fontSize: el.fontSize,
                    color: el.color,
                    fontWeight: el.bold ? "bold" : "normal",
                    fontStyle: el.italic ? "italic" : "normal",
                    lineHeight: 1.3,
                  }}
                >
                  {el.content}
                </div>
              )}
              {el.type === "color" && (
                <div className="w-full h-full rounded-sm" style={{ backgroundColor: el.color }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
