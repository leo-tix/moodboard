import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { InlineImageView } from "./InlineImageView";

// Node Tiptap "image inline" — permet au texte d'une note de contourner une
// image (façon magazine / Apple Journal), sans dupliquer le bloc `image`
// pleine largeur du carnet : on référence juste l'inspiration déjà attachée
// à la visite (`inspirationId`), la vignette est résolue au rendu.
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineImage: {
      insertInlineImage: (attrs: { inspirationId: string; thumbnailKey: string }) => ReturnType;
    };
  }
}

export const InlineImage = Node.create({
  name: "inlineImage",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      inspirationId: { default: null },
      thumbnailKey: { default: null },
      // Côté du flottement du texte — bascule via le bouton ⇄ dans la NodeView.
      float: { default: "left" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-image"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-type": "inline-image" }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineImageView);
  },

  addCommands() {
    return {
      insertInlineImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
