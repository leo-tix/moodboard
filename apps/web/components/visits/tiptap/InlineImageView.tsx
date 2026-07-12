"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { cn } from "@/lib/utils";

export function InlineImageView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const { thumbnailKey, float } = node.attrs as { thumbnailKey: string | null; float: "left" | "right" };

  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        "relative inline-block align-top mb-1 w-[42%] max-w-[220px]",
        float === "left" ? "float-left mr-3" : "float-right ml-3"
      )}
      contentEditable={false}
    >
      {thumbnailKey && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={getThumbnailUrl(thumbnailKey)}
          alt=""
          className="w-full rounded-md"
          draggable={false}
        />
      )}
      {editor.isEditable && (
        <div className="absolute top-1 right-1 flex gap-1">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => updateAttributes({ float: float === "left" ? "right" : "left" })}
            className="w-5 h-5 rounded-full bg-black/70 text-white text-[10px] flex items-center justify-center"
            title="Changer de côté"
          >
            ⇄
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => deleteNode()}
            className="w-5 h-5 rounded-full bg-black/70 text-white text-[10px] flex items-center justify-center"
            title="Retirer du texte"
          >
            ✕
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
