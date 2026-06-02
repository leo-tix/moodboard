"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { DropZone } from "@/components/upload/DropZone";
import { YouTubeImportClient } from "@/components/youtube/YouTubeImportClient";
import { SocialImportClient } from "@/components/upload/SocialImportClient";

const TABS = [
  { id: "files",   label: "Fichiers",              icon: "↑" },
  { id: "youtube", label: "YouTube",               icon: "▶" },
  { id: "social",  label: "Pinterest / Instagram", icon: "◈" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export function UploadTabs() {
  const [tab, setTab] = useState<Tab>("files");

  return (
    <div className="space-y-6">
      {/* Tab switcher */}
      <div className="flex flex-wrap gap-1 p-1 bg-[var(--bg-surface)] rounded-lg w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2",
              tab === t.id
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )}
          >
            <span className="font-mono text-xs opacity-50">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "files"   && <DropZone />}
      {tab === "youtube" && <YouTubeImportClient />}
      {tab === "social"  && <SocialImportClient />}
    </div>
  );
}
