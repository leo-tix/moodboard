"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { InlineImage } from "./tiptap/InlineImage";
import { AudioBlock } from "./tiptap/AudioBlock";
import { SlashCommand } from "./tiptap/SlashCommand";
import { pickSupportedAudioMimeType, requestMicrophone } from "@/lib/audio/recorder";

// ── Bloc de note façon Notion ────────────────────────────────────────────────
// `content` est stocké en HTML (sortie de `editor.getHTML()`) dans
// VisitNote.content — même colonne String qu'avant l'ajout du rich-text, pas
// de migration de schéma nécessaire (le texte brut historique reste du HTML
// valide, juste sans balises). StarterKit couvre : titres (H2/H3),
// gras/italique, listes, citation. InlineImage permet au texte de contourner
// une image de la visite (wrap façon magazine) ; AudioBlock insère un lecteur
// pour un clip micro. Phase 2 "table de montage" : la toolbar statique a
// disparu au profit d'une **toolbar fantôme** (BubbleMenu au surlignage) et
// de la **commande "/"** (SlashCommand) pour insérer les blocs.

const BASE_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    // Pas de bloc de code / règle horizontale : hors périmètre pour une note
    // de carnet. La citation (blockquote) est en revanche un bloc du plan
    // "table de montage" (Phase 2) — mise en avant typographique.
    codeBlock: false,
    horizontalRule: false,
  }),
  InlineImage,
  AudioBlock,
];

export interface NoteEditorImage {
  id: string; // inspirationId
  thumbnailKey: string | null;
}

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
  /** Images déjà attachées à la visite, proposées pour l'insertion inline. */
  visitImages?: NoteEditorImage[];
  /** Nécessaire pour uploader un clip audio enregistré (POST /api/visits/[id]/audio). */
  visitId?: string;
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const AUTOSAVE_DEBOUNCE_MS = 800;

export function NoteEditor({ content, editable, onBlurSave, onAutoSave, placeholder, className, visitImages = [], visitId }: NoteEditorProps) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
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
      // Une note momentanément vide ne se sauvegarde pas en continu — la
      // décision vide→suppression appartient au blur.
      if (!html.replace(/<[^>]*>/g, "").trim() && !html.includes("data-type")) return;
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

  // Popovers d'insertion (image de la visite / enregistreur micro) — ouverts
  // par la commande "/" (et par personne d'autre depuis la disparition de la
  // toolbar statique). Portés par NoteEditor pour être partagés.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);

  // Extensions par instance : SlashCommand ferme sur les setters de CE
  // composant. useMemo sans deps — les setters React sont stables.
  const extensions = useMemo(
    () => [
      ...BASE_EXTENSIONS,
      SlashCommand.configure({
        onInsertImage: () => setPickerOpen(true),
        onInsertAudio: () => setRecorderOpen(true),
      }),
    ],
    []
  );

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
    onBlur: ({ editor: e }) => {
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

  // L'insertion d'un bloc image/audio ne déclenche pas de blur (l'éditeur
  // reste focus) — sans sauvegarde immédiate, un rechargement/navigation
  // avant le prochain blur perdait le bloc inséré. Persiste SANS fermer
  // l'édition quand l'auto-save est câblé, sinon retombe sur le blur.
  const persistAfterInsert = () => {
    if (onAutoSaveRef.current) {
      setSaveState("saving");
      onAutoSaveRef.current(editor.getHTML())
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    } else {
      onBlurSave(editor.getHTML());
    }
  };

  return (
    <div className={cn("flex-1 min-w-0 relative", editable ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>
      {/* Hint façon Notion sur note vide en édition — remplace la toolbar
          statique comme point de découverte des blocs. */}
      {editable && editor.isEmpty && (
        <span className="pointer-events-none absolute top-0 left-0 text-sm italic text-[var(--text-tertiary)]">
          Écris, ou tape «&nbsp;/&nbsp;» pour insérer un bloc…
        </span>
      )}

      <EditorContent editor={editor} />
      {/* Après les images flottantes, le texte peut ne plus déborder assez
          bas pour "clear" le float — sans ça la bordure/le padding du bloc
          note se referme au-dessus d'une image encore visible. */}
      <div className="clear-both" />
      {!editable && editor.isEmpty && placeholder && (
        <span className="text-[var(--text-tertiary)] italic text-sm">{placeholder}</span>
      )}

      {editable && (
        <>
          {/* Toolbar fantôme : n'existe qu'au surlignage d'un passage */}
          <BubbleMenu
            editor={editor}
            className="flex items-center gap-0.5 px-1 py-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-2xl"
          >
            <BubbleButtons editor={editor} />
          </BubbleMenu>

          {/* Indicateur d'auto-save — même vocabulaire ●/✓ que MetadataPanel */}
          <span className="absolute -top-1 right-0 text-[10px] select-none" aria-live="polite">
            {saveState === "dirty" && <span className="text-[var(--text-tertiary)]">●</span>}
            {saveState === "saving" && <span className="text-[var(--text-tertiary)] animate-pulse">●</span>}
            {saveState === "saved" && <span className="text-[var(--accent)]">✓</span>}
            {saveState === "error" && <span className="text-red-400">⚠ non sauvegardé</span>}
          </span>

          {pickerOpen && (
            <ImagePickerPopover
              visitImages={visitImages}
              onPick={(img) => {
                editor.chain().focus().insertInlineImage({ inspirationId: img.id, thumbnailKey: img.thumbnailKey ?? "" }).run();
                setPickerOpen(false);
                persistAfterInsert();
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}
          {recorderOpen && visitId && (
            <AudioRecorderPopover
              visitId={visitId}
              editor={editor}
              onClose={() => setRecorderOpen(false)}
              onSave={persistAfterInsert}
            />
          )}
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
    { label: "H2", title: "Titre", active: editor.isActive("heading", { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "❝", title: "Citation", active: editor.isActive("blockquote"), onClick: () => editor.chain().focus().toggleBlockquote().run() },
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

// Sélecteur d'image de la visite — ouvert par la commande "/".
function ImagePickerPopover({
  visitImages,
  onPick,
  onClose,
}: {
  visitImages: NoteEditorImage[];
  onPick: (img: NoteEditorImage) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute top-1 left-0 z-50 w-60 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between px-2.5 pt-2">
        <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">Images de la visite</p>
        <button type="button" onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs">✕</button>
      </div>
      {visitImages.length === 0 ? (
        <p className="px-2.5 py-3 text-[11px] text-[var(--text-tertiary)]">Aucune image attachée à cette visite.</p>
      ) : (
        <div className="max-h-48 overflow-y-auto p-1.5 grid grid-cols-4 gap-1">
          {visitImages.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => onPick(img)}
              className="aspect-square rounded overflow-hidden bg-[var(--bg-surface)] hover:ring-1 hover:ring-[var(--text-primary)] transition-all"
            >
              {img.thumbnailKey && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={getThumbnailUrl(img.thumbnailKey)} alt="" className="w-full h-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AudioRecorderPopover({
  visitId,
  editor,
  onClose,
  onSave,
}: {
  visitId: string;
  editor: NonNullable<ReturnType<typeof useEditor>>;
  onClose: () => void;
  onSave: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);

  const previewUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  const startRecording = async () => {
    setError(null);
    const mic = await requestMicrophone();
    if (!mic.ok) {
      setError(mic.error);
      return;
    }
    streamRef.current = mic.stream;

    const supported = pickSupportedAudioMimeType();
    try {
      const recorder = supported ? new MediaRecorder(mic.stream, { mimeType: supported }) : new MediaRecorder(mic.stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        mic.stream.getTracks().forEach((t) => t.stop());
        if (chunksRef.current.length === 0) {
          setRecording(false);
          setError("Aucun son capté — réessaie l'enregistrement.");
          return;
        }
        setBlob(new Blob(chunksRef.current, { type: recorder.mimeType || supported || "audio/webm" }));
        setDurationSec(Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)));
      };
      // Filet si l'OS reprend le micro en cours d'enregistrement (voir
      // VisitCaptureFab pour le détail) — sans ça l'UI reste bloquée sur
      // "Arrêter" sans que le clic n'ait plus d'effet.
      mic.stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (recorderRef.current && recorderRef.current.state !== "inactive") {
            try { recorderRef.current.stop(); } catch { /* déjà arrêté */ }
          }
        };
      });
      recorder.onerror = () => {
        mic.stream.getTracks().forEach((t) => t.stop());
        setError("Erreur d'enregistrement — réessaie.");
        setRecording(false);
      };
      startedAtRef.current = Date.now();
      recorder.start();
      setRecording(true);
    } catch {
      mic.stream.getTracks().forEach((t) => t.stop());
      setError("Format d'enregistrement non pris en charge par ce navigateur.");
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    setRecording(false);
    if (!recorder || recorder.state === "inactive") return;
    try {
      recorder.stop();
    } catch {
      setError("Erreur lors de l'arrêt de l'enregistrement.");
    }
  };

  const confirmUpload = async () => {
    if (!blob) return;
    setUploading(true);
    setError(null);
    try {
      const ext = (blob.type.split(";")[0].split("/")[1]) || "webm";
      const fd = new FormData();
      fd.append("file", blob, `clip.${ext}`);
      fd.append("durationSec", String(durationSec));
      const res = await fetch(`/api/visits/${visitId}/audio`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de l'envoi");
        return;
      }
      editor.chain().focus().insertAudioBlock({
        audioId: data.id,
        storageKey: data.storageKey,
        durationSec: data.durationSec,
      }).run();
      onSave();
      onClose();
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="absolute top-1 left-0 z-50 w-56 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl"
      // Sans ce garde (hérité de l'ancienne toolbar statique), cliquer un
      // bouton du popover blur l'éditeur → l'édition se ferme → le popover
      // se démonte en plein enregistrement.
      onMouseDown={(e) => e.preventDefault()}
    >
      {error && <p className="text-[10px] text-red-400 mb-2">{error}</p>}
      {!blob ? (
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          className={cn(
            "w-full py-2 rounded-md text-xs font-medium transition-colors",
            recording
              ? "bg-red-500/20 text-red-400"
              : "bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-base)]"
          )}
        >
          {recording ? "⏹ Arrêter" : "🎙 Enregistrer"}
        </button>
      ) : (
        <div className="space-y-2">
          {previewUrl && <audio controls src={previewUrl} className="w-full h-8" />}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setBlob(null)}
              className="flex-1 py-1.5 rounded-md text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-[var(--border-default)] transition-colors"
            >
              Refaire
            </button>
            <button
              type="button"
              onClick={confirmUpload}
              disabled={uploading}
              className="flex-1 py-1.5 rounded-md text-[11px] bg-[var(--text-primary)] text-[var(--bg-base)] disabled:opacity-50 transition-opacity"
            >
              {uploading ? "…" : "Ajouter"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
