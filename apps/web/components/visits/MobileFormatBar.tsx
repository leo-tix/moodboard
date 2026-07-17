"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bold, Italic, Heading3, List, ListOrdered } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";

// Barre de formatage ancrée JUSTE AU-DESSUS DU CLAVIER sur mobile, pendant
// l'édition d'un bloc texte. Le surlignage-pour-mettre-en-gras (BubbleMenu)
// est peu fiable au tactile — cette barre donne un accès direct à
// gras/italique/sous-titre/listes. Positionnée via la VisualViewport API
// (seul moyen fiable de suivre la hauteur réelle du clavier, iOS compris).
export function MobileFormatBar({ editor }: { editor: Editor }) {
  const [bottom, setBottom] = useState(0);
  // Re-render sur changement de sélection pour refléter l'état actif des boutons.
  const [, force] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setBottom(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  useEffect(() => {
    const on = () => force((x) => x + 1);
    editor.on("selectionUpdate", on);
    editor.on("transaction", on);
    return () => {
      editor.off("selectionUpdate", on);
      editor.off("transaction", on);
    };
  }, [editor]);

  if (typeof document === "undefined") return null;

  const btns = [
    { icon: Bold, title: "Gras", active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { icon: Italic, title: "Italique", active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { icon: Heading3, title: "Sous-titre", active: editor.isActive("heading", { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { icon: List, title: "Liste à puces", active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { icon: ListOrdered, title: "Liste numérotée", active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
  ];

  return createPortal(
    <div
      // z-[90] : au-dessus du panneau d'édition bento (EditDrawer, z-[81])
      // depuis lequel cette barre s'ouvre désormais (bloc "Texte" en tuile) —
      // sinon le panneau masquait la barre de formatage pendant la frappe
      // sur mobile (bug constaté 2026-07-17).
      className="fixed inset-x-0 z-[90] flex items-center gap-1 px-2 py-1.5 bg-[var(--bg-elevated)] border-t border-[var(--border-default)] shadow-[0_-4px_16px_rgba(0,0,0,0.25)]"
      style={{ bottom }}
      // Ne PAS voler le focus de l'éditeur : sinon le clavier se ferme et le
      // blur termine l'édition avant que la commande n'agisse.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      {btns.map((b) => (
        <button
          key={b.title}
          type="button"
          title={b.title}
          aria-label={b.title}
          onClick={b.run}
          className={cn(
            "flex-1 h-10 flex items-center justify-center rounded-md transition-colors",
            b.active
              ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
              : "text-[var(--text-secondary)] active:bg-[var(--bg-surface)]",
          )}
        >
          <b.icon size={18} strokeWidth={2} />
        </button>
      ))}
    </div>,
    document.body,
  );
}
