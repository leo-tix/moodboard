"use client";

import { Component, type ReactNode } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { getAudioUrl } from "@/lib/storage/urls";
import { AudioPlayer } from "@/components/visits/AudioPlayer";

// Filet de sécurité critique : si le lecteur custom crashe (comportement
// audio/Web Audio divergent selon plateforme — vu sur iOS en conditions
// réelles), un crash non contenu fait tomber TOUT l'arbre React (page
// d'erreur Next), et le node Tiptap sorti du document est ensuite perdu à la
// prochaine sauvegarde de la note — le cleanup serveur supprime alors le clip
// R2 définitivement. Le boundary contient le crash au seul lecteur et affiche
// le <audio> natif à la place : le clip reste écoutable ET le node survit.
class AudioPlayerBoundary extends Component<
  { src: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return <audio controls src={this.props.src} className="flex-1 h-8" style={{ minWidth: 0 }} />;
    }
    return this.props.children;
  }
}

export function AudioBlockView({ node, deleteNode, editor }: NodeViewProps) {
  const { storageKey, durationSec } = node.attrs as { storageKey: string | null; durationSec: number | null };

  return (
    <NodeViewWrapper
      className="my-2 flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2"
      contentEditable={false}
      // Un tap sur le lecteur (play, ±15s, waveform) ne doit pas remonter au
      // bloc note parent, dont le onClick ouvre l'éditeur — sur mobile ça
      // basculait la note en édition en pleine lecture.
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
    >
      {storageKey && (
        <AudioPlayerBoundary src={getAudioUrl(storageKey)}>
          <AudioPlayer src={getAudioUrl(storageKey)} durationSec={durationSec} />
        </AudioPlayerBoundary>
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
