"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Heading1, Heading2, Pilcrow, Bold, Italic, Quote, List, ListOrdered, type LucideIcon } from "lucide-react";
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

  // Jeu complet, groupé (structure de bloc | style de texte | listes) — mêmes
  // options que le module texte unique (2026-07-18). `sep: true` insère un fin
  // séparateur avant le bouton.
  const btns: { icon: LucideIcon; title: string; active: boolean; run: () => void; sep?: boolean }[] = [
    { icon: Heading1, title: "Titre", active: editor.isActive("heading", { level: 1 }), run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { icon: Heading2, title: "Sous-titre", active: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: Pilcrow, title: "Paragraphe", active: editor.isActive("paragraph"), run: () => editor.chain().focus().setParagraph().run() },
    { icon: Bold, title: "Gras", active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run(), sep: true },
    { icon: Italic, title: "Italique", active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { icon: Quote, title: "Citation", active: editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
    { icon: List, title: "Liste à puces", active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run(), sep: true },
    { icon: ListOrdered, title: "Liste numérotée", active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
  ];

  return createPortal(
    <div
      // z-[90] : au-dessus du panneau d'édition bento (TileSettingsModal,
      // z-[81]) d'où cette barre s'ouvre — sinon le panneau la masquerait.
      className="fixed inset-x-0 z-[90] flex items-center gap-0.5 px-2 py-2 bg-[var(--bg-elevated)]/95 backdrop-blur-md border-t border-[var(--border-default)] shadow-[0_-4px_20px_rgba(0,0,0,0.35)]"
      style={{ bottom }}
    >
      {btns.map((b) => (
        <div key={b.title} className={cn("flex items-center flex-1", b.sep && "border-l border-[var(--border-subtle)] ml-0.5 pl-1")}>
          <button
            type="button"
            title={b.title}
            aria-label={b.title}
            aria-pressed={b.active}
            // Action sur pointerDown + preventDefault : au tactile, un onClick
            // classique n'était jamais atteint (le tap retire le focus →
            // blur → fermeture avant le clic). preventDefault préserve le
            // focus/la sélection et couvre souris + tactile (bug 2026-07-18).
            onPointerDown={(e) => { e.preventDefault(); b.run(); }}
            className={cn(
              "w-full h-10 flex items-center justify-center rounded-lg transition-colors",
              b.active
                ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                : "text-[var(--text-secondary)] active:bg-[var(--bg-surface)]",
            )}
          >
            <b.icon size={18} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
