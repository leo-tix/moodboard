"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { cn } from "@/lib/utils";

// ── Bloc de note façon Notion ────────────────────────────────────────────────
// `content` est stocké en HTML (sortie de `editor.getHTML()`) dans
// VisitNote.content — même colonne String qu'avant l'ajout du rich-text, pas
// de migration de schéma nécessaire (le texte brut historique reste du HTML
// valide, juste sans balises). StarterKit couvre exactement le périmètre
// demandé : titres (H2/H3), gras/italique, listes à puces/numérotées.

const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    // Pas de bloc de code / citation / règle horizontale : hors périmètre
    // pour une note de carnet, on garde la barre d'outils courte.
    codeBlock: false,
    blockquote: false,
    horizontalRule: false,
  }),
];

interface NoteEditorProps {
  content: string;
  editable: boolean;
  onBlurSave: (html: string) => void;
  placeholder?: string;
  className?: string;
}

export function NoteEditor({ content, editable, onBlurSave, placeholder, className }: NoteEditorProps) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn("note-prose text-sm leading-relaxed cursor-text focus:outline-none min-h-[1.5rem]", className),
      },
      handleKeyDown: (view, event) => {
        if (event.key === "Escape") {
          (view.dom as HTMLElement).blur();
          return true;
        }
        return false;
      },
    },
    onBlur: ({ editor: e }) => onBlurSave(e.getHTML()),
  });

  // Le carnet peut réordonner l'item en dehors de l'édition (isEditing bascule
  // dans le parent) : resynchronise l'éditeur si `editable` change de valeur.
  useEffect(() => {
    if (!editor || editor.isEditable === editable) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (editable) editor?.chain().focus("end").run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);

  // Resynchronise l'affichage si `content` change de l'extérieur (ex. après
  // sauvegarde) sans écraser une saisie en cours.
  useEffect(() => {
    if (!editor || editable || editor.getHTML() === content) return;
    editor.commands.setContent(content, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, editable, editor]);

  if (!editor) return null;

  return (
    <div className={cn("flex-1 min-w-0", editable ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>
      {editable && <NoteToolbar editor={editor} />}
      <EditorContent editor={editor} />
      {!editable && editor.isEmpty && placeholder && (
        <span className="text-[var(--text-tertiary)] italic text-sm">{placeholder}</span>
      )}
    </div>
  );
}

function NoteToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;

  const buttons: { label: string; title: string; active: boolean; onClick: () => void }[] = [
    { label: "B", title: "Gras", active: editor.isActive("bold"), onClick: () => editor.chain().focus().toggleBold().run() },
    { label: "I", title: "Italique", active: editor.isActive("italic"), onClick: () => editor.chain().focus().toggleItalic().run() },
    { label: "H2", title: "Titre", active: editor.isActive("heading", { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "•", title: "Liste à puces", active: editor.isActive("bulletList"), onClick: () => editor.chain().focus().toggleBulletList().run() },
    { label: "1.", title: "Liste numérotée", active: editor.isActive("orderedList"), onClick: () => editor.chain().focus().toggleOrderedList().run() },
  ];

  return (
    <div
      className="flex items-center gap-0.5 mb-1.5 -ml-1"
      // Empêche le blur de l'éditeur (qui déclenche la sauvegarde) avant que
      // le clic sur le bouton n'ait eu le temps d'agir sur la sélection.
      onMouseDown={(e) => e.preventDefault()}
    >
      {buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          title={b.title}
          onClick={b.onClick}
          className={cn(
            "w-6 h-6 flex items-center justify-center rounded text-[11px] font-medium transition-colors",
            b.active
              ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          )}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
