import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { AudioBlockView } from "./AudioBlockView";

// Node Tiptap "clip audio" — lecteur inline dans une note du carnet.
// `storageKey` est dénormalisé sur le node (comme `thumbnailKey` sur
// InlineImage) pour ne pas avoir à refetcher VisitAudio juste pour l'afficher.
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    audioBlock: {
      insertAudioBlock: (attrs: { audioId: string; storageKey: string; durationSec: number | null }) => ReturnType;
    };
  }
}

export const AudioBlock = Node.create({
  name: "audioBlock",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      audioId: { default: null },
      storageKey: { default: null },
      durationSec: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="audio-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-type": "audio-block" }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioBlockView);
  },

  addCommands() {
    return {
      insertAudioBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
