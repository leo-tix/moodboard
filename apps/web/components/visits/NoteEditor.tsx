"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { InlineImage } from "./tiptap/InlineImage";
import { AudioBlock } from "./tiptap/AudioBlock";

// ── Bloc de note façon Notion ────────────────────────────────────────────────
// `content` est stocké en HTML (sortie de `editor.getHTML()`) dans
// VisitNote.content — même colonne String qu'avant l'ajout du rich-text, pas
// de migration de schéma nécessaire (le texte brut historique reste du HTML
// valide, juste sans balises). StarterKit couvre exactement le périmètre
// demandé : titres (H2/H3), gras/italique, listes à puces/numérotées.
// InlineImage (tiptap/InlineImage.ts) permet en plus au texte de contourner
// une image de la visite (wrap façon magazine/Apple Journal). AudioBlock
// (tiptap/AudioBlock.ts) insère un lecteur pour un clip enregistré au micro.

const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    // Pas de bloc de code / citation / règle horizontale : hors périmètre
    // pour une note de carnet, on garde la barre d'outils courte.
    codeBlock: false,
    blockquote: false,
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
  placeholder?: string;
  className?: string;
  /** Images déjà attachées à la visite, proposées pour l'insertion inline. */
  visitImages?: NoteEditorImage[];
  /** Nécessaire pour uploader un clip audio enregistré (POST /api/visits/[id]/audio). */
  visitId?: string;
}

export function NoteEditor({ content, editable, onBlurSave, placeholder, className, visitImages = [], visitId }: NoteEditorProps) {
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
      {editable && <NoteToolbar editor={editor} visitImages={visitImages} visitId={visitId} />}
      <EditorContent editor={editor} />
      {/* Après les images flottantes, le texte peut ne plus déborder assez
          bas pour "clear" le float — sans ça la bordure/le padding du bloc
          note se referme au-dessus d'une image encore visible. */}
      <div className="clear-both" />
      {!editable && editor.isEmpty && placeholder && (
        <span className="text-[var(--text-tertiary)] italic text-sm">{placeholder}</span>
      )}
    </div>
  );
}

function NoteToolbar({
  editor,
  visitImages,
  visitId,
}: {
  editor: ReturnType<typeof useEditor>;
  visitImages: NoteEditorImage[];
  visitId?: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);

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
      className="relative flex items-center gap-0.5 mb-1.5 -ml-1"
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
            "w-9 h-9 md:w-6 md:h-6 flex items-center justify-center rounded text-sm md:text-[11px] font-medium transition-colors",
            b.active
              ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          )}
        >
          {b.label}
        </button>
      ))}

      {visitImages.length > 0 && (
        <>
          <span className="w-px h-4 bg-[var(--border-default)] mx-1" />
          <button
            type="button"
            title="Insérer une image de la visite"
            onClick={() => setPickerOpen((v) => !v)}
            className={cn(
              "w-9 h-9 md:w-6 md:h-6 flex items-center justify-center rounded text-sm md:text-[11px] font-medium transition-colors",
              pickerOpen
                ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
            )}
          >
            🖼
          </button>
          {pickerOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 w-56 max-h-48 overflow-y-auto p-1.5 grid grid-cols-4 gap-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl">
              {visitImages.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => {
                    editor.chain().focus().insertInlineImage({ inspirationId: img.id, thumbnailKey: img.thumbnailKey ?? "" }).run();
                    setPickerOpen(false);
                  }}
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
        </>
      )}

      {visitId && (
        <>
          <span className="w-px h-4 bg-[var(--border-default)] mx-1" />
          <button
            type="button"
            title="Enregistrer un clip audio"
            onClick={() => setRecorderOpen((v) => !v)}
            className={cn(
              "w-9 h-9 md:w-6 md:h-6 flex items-center justify-center rounded text-sm md:text-[11px] font-medium transition-colors",
              recorderOpen
                ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
            )}
          >
            🎙
          </button>
          {recorderOpen && (
            <AudioRecorderPopover visitId={visitId} editor={editor} onClose={() => setRecorderOpen(false)} />
          )}
        </>
      )}
    </div>
  );
}

function AudioRecorderPopover({
  visitId,
  editor,
  onClose,
}: {
  visitId: string;
  editor: NonNullable<ReturnType<typeof useEditor>>;
  onClose: () => void;
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        setBlob(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
        setDurationSec(Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)));
        stream.getTracks().forEach((t) => t.stop());
      };
      startedAtRef.current = Date.now();
      recorder.start();
      setRecording(true);
    } catch {
      setError("Micro inaccessible — vérifie les permissions du navigateur.");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
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
      onClose();
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="absolute top-full left-0 mt-1 z-50 w-56 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl">
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
