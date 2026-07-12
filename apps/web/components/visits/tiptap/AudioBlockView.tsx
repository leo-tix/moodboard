"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { getAudioUrl } from "@/lib/storage/urls";

export function AudioBlockView({ node, deleteNode, editor }: NodeViewProps) {
  const { storageKey, durationSec } = node.attrs as { storageKey: string | null; durationSec: number | null };

  return (
    <NodeViewWrapper
      className="my-2 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2"
      contentEditable={false}
    >
      <span className="text-[var(--text-tertiary)] text-sm flex-shrink-0">🎙</span>
      {storageKey && (
        <audio controls src={getAudioUrl(storageKey)} className="flex-1 h-8" style={{ minWidth: 0 }} />
      )}
      {durationSec != null && (
        <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
          {Math.floor(durationSec / 60)}:{String(durationSec % 60).padStart(2, "0")}
        </span>
      )}
      {editor.isEditable && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => deleteNode()}
          className="w-5 h-5 flex-shrink-0 rounded-full bg-black/40 text-white text-[10px] flex items-center justify-center hover:bg-black/60"
          title="Retirer"
        >
          ✕
        </button>
      )}
    </NodeViewWrapper>
  );
}
