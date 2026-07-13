"use client";

import { Component, type ReactNode } from "react";

// Filet de sécurité : si le lecteur custom (waveform Web Audio) crashe —
// comportement divergent selon plateforme, vu sur iOS en conditions réelles —
// un crash non contenu fait tomber tout l'arbre React de la page. Le
// boundary contient le crash au seul lecteur et affiche le <audio> natif à
// la place : le clip reste écoutable.
export class AudioPlayerBoundary extends Component<{ src: string; children: ReactNode }, { failed: boolean }> {
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
