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
    // Module texte UNIQUE (2026-07-18) : le titre (H1), le sous-titre (H2),
    // l'intertitre (H3) et la citation sont désormais des options de formatage
    // de ce seul bloc — plus de blocs Titre/Citation séparés.
    heading: { levels: [1, 2, 3] },
    codeBlock: false,
    horizontalRule: false,
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
  /**
   * Barre d'outils de formatage TOUJOURS visible au-dessus du texte (au lieu
   * de la barre-bulle au survol + barre mobile ancrée au clavier). Demande
   * utilisateur 2026-07-18 : "remettre tous les paramètres d'édition de texte
   * enrichi visibles directement dans la section d'édition". Utilisé par
   * l'édition inline/pop-up du carnet bento.
   */
  showToolbar?: boolean;
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const AUTOSAVE_DEBOUNCE_MS = 800;

export function NoteEditor({ content, editable, onBlurSave, onAutoSave, placeholder, className, showToolbar = false }: NoteEditorProps) {
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
      {/* Barre d'outils persistante (édition du carnet) — tous les contrôles
          de formatage visibles en continu. */}
      {editable && showToolbar && (
        <div
          className="flex items-center gap-0.5 mb-2 pb-2 border-b border-[var(--border-subtle)] flex-wrap"
          onMouseDown={(e) => e.preventDefault()}
        >
          <BubbleButtons editor={editor} />
        </div>
      )}

      {/* Hint façon Notion sur bloc vide en édition — remplace la toolbar
          statique comme point de découverte des types de texte. */}
      {editable && editor.isEmpty && !showToolbar && (
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

// Boutons de formatage — le module texte unique réunit titre/paragraphe/
// citation (2026-07-18) : ils sont ici des options de formatage.
function BubbleButtons({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  const buttons: { label: string; title: string; active: boolean; onClick: () => void }[] = [
    { label: "Titre", title: "Titre", active: editor.isActive("heading", { level: 1 }), onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: "S-titre", title: "Sous-titre", active: editor.isActive("heading", { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "¶", title: "Paragraphe", active: editor.isActive("paragraph"), onClick: () => editor.chain().focus().setParagraph().run() },
    { label: "B", title: "Gras", active: editor.isActive("bold"), onClick: () => editor.chain().focus().toggleBold().run() },
    { label: "I", title: "Italique", active: editor.isActive("italic"), onClick: () => editor.chain().focus().toggleItalic().run() },
    { label: "❝", title: "Citation", active: editor.isActive("blockquote"), onClick: () => editor.chain().focus().toggleBlockquote().run() },
    { label: "•", title: "Liste à puces", active: editor.isActive("bulletList"), onClick: () => editor.chain().focus().toggleBulletList().run() },
    { label: "1.", title: "Liste numérotée", active: editor.isActive("orderedList"), onClick: () => editor.chain().focus().toggleOrderedList().run() },
  ];
  return (
    <span className="contents">
      {buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          title={b.title}
          // Action déclenchée sur pointerDown, PAS onClick : sur tactile, le
          // simple fait de toucher le bouton retire le focus de l'éditeur
          // (blur → sauvegarde/fermeture) avant qu'un onClick n'ait lieu, donc
          // les boutons de format ne faisaient rien sur mobile (bug
          // 2026-07-18). preventDefault ici préserve le focus/la sélection et
          // couvre souris + tactile ; on exécute la commande dans la foulée.
          onPointerDown={(e) => { e.preventDefault(); b.onClick(); }}
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
