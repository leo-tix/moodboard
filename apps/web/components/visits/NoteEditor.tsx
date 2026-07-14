"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SlashCommand } from "./tiptap/SlashCommand";
import { MobileFormatBar } from "./MobileFormatBar";

// ── Bloc de texte pur du carnet façon Notion ────────────────────────────────
// `content` est stocké en HTML (sortie de `editor.getHTML()`) dans
// VisitNote.content. StarterKit couvre : sous-titre (H3), gras/italique,
// listes. Le Titre (H2) est un bloc autonome (VisitTitle, voir
// TitleEditor.tsx) depuis le 2026-07-13 — un bloc texte ne contient plus de
// titre/image/audio/citation intégrés. La toolbar fantôme (BubbleMenu au
// surlignage) et la commande "/" (SlashCommand) couvrent le formatage inline
// et les blocs de texte (sous-titre/paragraphe/listes) — plus de titre, de
// citation ni d'image/audio dans ce menu, devenus des types de blocs à part
// entière du carnet (voir VisitJournal).

const BASE_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [3] },
    // Hors périmètre d'un bloc texte pur : pas de bloc de code / règle
    // horizontale / citation (la citation est son propre type de bloc,
    // VisitQuote — voir QuoteEditor.tsx).
    codeBlock: false,
    horizontalRule: false,
    blockquote: false,
  }),
];

interface NoteEditorProps {
  content: string;
  editable: boolean;
  onBlurSave: (html: string) => void;
  /**
   * Sauvegarde continue pendant la frappe (debouncée) — ne ferme pas
   * l'édition, contrairement à onBlurSave. Alimente l'indicateur ●/✓.
   */
  onAutoSave?: (html: string) => Promise<void>;
  placeholder?: string;
  className?: string;
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const AUTOSAVE_DEBOUNCE_MS = 800;

export function NoteEditor({ content, editable, onBlurSave, onAutoSave, placeholder, className }: NoteEditorProps) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // Barre de formatage mobile : affichée quand l'éditeur est focus sur tactile.
  const [focused, setFocused] = useState(false);
  const isTouch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const debounceRef = useRef<number | null>(null);
  const savedFadeRef = useRef<number | null>(null);
  // Refs pour lire les callbacks/état à jour depuis les handlers Tiptap
  // (figés à la création de l'instance, cf. pièges useEditor plus bas).
  const onAutoSaveRef = useRef(onAutoSave);
  onAutoSaveRef.current = onAutoSave;

  const scheduleAutoSave = (getHtml: () => string) => {
    if (!onAutoSaveRef.current) return;
    setSaveState("dirty");
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      const html = getHtml();
      // Un bloc momentanément vide ne se sauvegarde pas en continu — la
      // décision vide→suppression appartient au blur.
      if (!html.replace(/<[^>]*>/g, "").trim()) return;
      setSaveState("saving");
      try {
        await onAutoSaveRef.current?.(html);
        setSaveState("saved");
        if (savedFadeRef.current) window.clearTimeout(savedFadeRef.current);
        savedFadeRef.current = window.setTimeout(() => setSaveState("idle"), 1600);
      } catch {
        setSaveState("error");
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  useEffect(() => () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (savedFadeRef.current) window.clearTimeout(savedFadeRef.current);
  }, []);

  // Extension par instance — useMemo sans deps (pas d'options dynamiques).
  const extensions = useMemo(() => [...BASE_EXTENSIONS, SlashCommand], []);

  const editor = useEditor({
    extensions,
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
    onUpdate: ({ editor: e }) => scheduleAutoSave(() => e.getHTML()),
    onFocus: () => setFocused(true),
    onBlur: ({ editor: e }) => {
      setFocused(false);
      // Le blur prend la main : annule l'auto-save en attente pour ne pas
      // sauvegarder après coup un contenu que le blur a pu supprimer (vide).
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      setSaveState("idle");
      onBlurSave(e.getHTML());
    },
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
    <div className={cn("flex-1 min-w-0 relative", editable ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>
      {/* Hint façon Notion sur bloc vide en édition — remplace la toolbar
          statique comme point de découverte des types de texte. */}
      {editable && editor.isEmpty && (
        <span className="pointer-events-none absolute top-0 left-0 text-sm italic text-[var(--text-tertiary)]">
          Écris, ou tape «&nbsp;/&nbsp;» pour insérer un titre ou une liste…
        </span>
      )}

      <EditorContent editor={editor} />
      {!editable && editor.isEmpty && placeholder && (
        <span className="text-[var(--text-tertiary)] italic text-sm">{placeholder}</span>
      )}

      {editable && (
        <>
          {/* Desktop : toolbar fantôme au surlignage. Sur tactile on la masque
              (surlignage peu fiable) au profit de la barre ancrée au clavier —
              sinon les deux barres font DOUBLON. */}
          {!isTouch && (
            <BubbleMenu
              editor={editor}
              className="flex items-center gap-0.5 px-1 py-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-2xl"
            >
              <BubbleButtons editor={editor} />
            </BubbleMenu>
          )}

          {/* Mobile : barre de formatage ancrée au-dessus du clavier (le
              surlignage-pour-formater est peu fiable au tactile). */}
          {isTouch && focused && <MobileFormatBar editor={editor} />}

          {/* Indicateur d'auto-save — même vocabulaire ●/✓ que MetadataPanel */}
          <span className="absolute -top-1 right-0 text-[10px] select-none" aria-live="polite">
            {saveState === "dirty" && <span className="text-[var(--text-tertiary)]">●</span>}
            {saveState === "saving" && <span className="text-[var(--text-tertiary)] animate-pulse">●</span>}
            {saveState === "saved" && <span className="text-[var(--accent)] inline-flex items-center"><Check size={12} strokeWidth={2.5} /></span>}
            {saveState === "error" && <span className="text-red-400">⚠ non sauvegardé</span>}
          </span>
        </>
      )}
    </div>
  );
}

// Boutons de la toolbar fantôme — formatage inline + blocs de texte courants.
function BubbleButtons({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  const buttons: { label: string; title: string; active: boolean; onClick: () => void }[] = [
    { label: "B", title: "Gras", active: editor.isActive("bold"), onClick: () => editor.chain().focus().toggleBold().run() },
    { label: "I", title: "Italique", active: editor.isActive("italic"), onClick: () => editor.chain().focus().toggleItalic().run() },
    { label: "H3", title: "Sous-titre", active: editor.isActive("heading", { level: 3 }), onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "•", title: "Liste à puces", active: editor.isActive("bulletList"), onClick: () => editor.chain().focus().toggleBulletList().run() },
    { label: "1.", title: "Liste numérotée", active: editor.isActive("orderedList"), onClick: () => editor.chain().focus().toggleOrderedList().run() },
  ];
  return (
    <span
      className="contents"
      // Empêche le blur de l'éditeur (qui ferme l'édition) avant que le clic
      // sur le bouton n'ait agi sur la sélection.
      onMouseDown={(e) => e.preventDefault()}
    >
      {buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          title={b.title}
          onClick={b.onClick}
          className={cn(
            "w-8 h-8 md:w-7 md:h-7 flex items-center justify-center rounded text-sm md:text-[11px] font-medium transition-colors",
            b.active
              ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
          )}
        >
          {b.label}
        </button>
      ))}
    </span>
  );
}
