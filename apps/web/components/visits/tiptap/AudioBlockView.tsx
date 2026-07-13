"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { getAudioUrl } from "@/lib/storage/urls";
import { AudioPlayer } from "@/components/visits/AudioPlayer";

export function AudioBlockView({ node, deleteNode, editor }: NodeViewProps) {
  const { storageKey, durationSec } = node.attrs as { storageKey: string | null; durationSec: number | null };

  return (
    <NodeViewWrapper
      className="my-2 flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2"
      contentEditable={false}
    >
      {storageKey && <AudioPlayer src={getAudioUrl(storageKey)} durationSec={durationSec} />}
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
