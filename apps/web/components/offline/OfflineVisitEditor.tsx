"use client";

import { useRef, useState } from "react";
import { ArrowLeft, Camera, Mic, Type, Image as ImageIcon, Check, Loader2, Pencil } from "lucide-react";
import { VoiceMemoRecorder } from "@/components/visits/VoiceMemoRecorder";
import { compressImageForUpload } from "@/lib/image/clientResize";
import { BlockTypeModal } from "@/components/visits/BlockTypeModal";
import { TileSettingsModal, type CartelFormValues, type TicketFormValues } from "@/components/visits/bento/TileSettingsModal";
import { DEFAULT_SPAN } from "@/lib/visits/bentoSpans";
import type { BentoTile } from "@/lib/visits/bentoTypes";
import {
  appendLocalBlock, patchLocalBlock, removeLocalBlock,
  type LocalBlock, type LocalVisit,
} from "@/lib/offline/localVisits";

// Contenu par défaut d'un module créé hors ligne — miroir de ce que crée la
// route API correspondante, pour que la tuile s'affiche et s'édite pareil.
const DEFAUT: Record<string, Record<string, unknown>> = {
  highlight: { title: "", rating: 0, note: null },
  checklist: { title: null, items: [] },
  timeline:  { title: null, events: [] },
  cartel:    { artworkTitle: "", artist: null, dateText: null, medium: null, dimensions: null, room: null, notes: null },
  ticket:    { eventName: "", place: null, dateText: null, price: null, category: null },
  palette:   { title: null, colors: [] },
  separator: { label: "Section" },
};

// Reconstruit une tuile bento à partir d'un bloc local, pour pouvoir réutiliser
// TileSettingsModal — les MÊMES formulaires qu'en ligne, plutôt qu'une seconde
// interface qui divergerait.
function tuileDepuisBloc(b: LocalBlock): BentoTile | null {
  if (!DEFAUT[b.type]) return null;
  const span = DEFAULT_SPAN[b.type as keyof typeof DEFAULT_SPAN] ?? { w: 2, h: 1 };
  const content = { type: b.type, id: b.localId, ...(b.payload ?? {}) };
  return { type: b.type, id: b.localId, w: span.w, h: span.h, content } as unknown as BentoTile;
}

// Carnet HORS LIGNE d'une visite : volontairement centré sur la CAPTURE
// (photo, mémo vocal, note), qui est ce qu'on fait réellement pendant une
// visite. La mise en page bento, les modules riches et la réorganisation
// restent en ligne — ils s'appliquent au carnet une fois la visite synchronisée.

export function OfflineVisitEditor({
  visit,
  onBack,
  onChange,
}: {
  visit: LocalVisit;
  onBack: () => void;
  onChange: (v: LocalVisit) => void;
}) {
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const galerieRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const synced = visit.syncState === "synced";

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(`Enregistrement de ${files.length} photo${files.length > 1 ? "s" : ""}…`);
    try {
      // Compression AVANT stockage : on garde ~1 Mo par photo au lieu de 10-20,
      // ce qui compte doublement hors ligne (quota IndexedDB) et à la synchro.
      for (const f of Array.from(files)) {
        const blob = await compressImageForUpload(f);
        const maj = await appendLocalBlock(visit.localId, {
          type: "photo",
          blob,
          filename: blob.name || `photo-${Date.now()}.jpg`,
        });
        if (maj) onChange(maj);
      }
    } finally {
      setBusy(null);
      if (galerieRef.current) galerieRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  };

  const addMemo = async (blob: Blob, durationSec: number) => {
    setRecorderOpen(false);
    const maj = await appendLocalBlock(visit.localId, {
      type: "memo",
      blob,
      filename: `memo-${Date.now()}.webm`,
      durationSec,
    });
    if (maj) onChange(maj);
  };

  const addNote = async () => {
    const v = note.trim();
    if (!v) { setNoteOpen(false); return; }
    const maj = await appendLocalBlock(visit.localId, { type: "note", content: v });
    if (maj) onChange(maj);
    setNote("");
    setNoteOpen(false);
  };

  // ── Modules ──────────────────────────────────────────────────────────────
  const ajouterModule = async (type: string) => {
    setPickerOpen(false);
    const maj = await appendLocalBlock(visit.localId, {
      type: type as LocalBlock["type"],
      payload: { ...DEFAUT[type] },
    });
    if (maj) {
      onChange(maj);
      // Ouvre aussitôt le formulaire : un module vide n'a aucun intérêt.
      setEditing(maj.blocks[maj.blocks.length - 1].localId);
    }
  };

  const majModule = async (blockId: string, payload: Record<string, unknown>) => {
    const maj = await patchLocalBlock(visit.localId, blockId, payload);
    if (maj) onChange(maj);
  };

  const supprimerModule = async (blockId: string) => {
    const maj = await removeLocalBlock(visit.localId, blockId);
    if (maj) onChange(maj);
    setEditing(null);
  };

  const blocEnEdition = visit.blocks.find((b) => b.localId === editing) ?? null;
  const tuileEnEdition = blocEnEdition ? tuileDepuisBloc(blocEnEdition) : null;
  const modules = visit.blocks.filter((b) => DEFAUT[b.type]);

  const compte = {
    photo: visit.blocks.filter((b) => b.type === "photo").length,
    memo: visit.blocks.filter((b) => b.type === "memo").length,
    note: visit.blocks.filter((b) => b.type === "note").length,
  };

  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <ArrowLeft size={14} strokeWidth={2} /> Toutes les visites
      </button>

      <div>
        <h2 className="font-serif text-xl text-[var(--text-primary)]">
          {visit.exhibition || visit.place}
        </h2>
        {visit.exhibition && <p className="text-sm text-[var(--text-secondary)]">{visit.place}</p>}
        <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
          {new Date(visit.visitDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
          {" · "}
          {visit.blocks.length} élément{visit.blocks.length > 1 ? "s" : ""}
        </p>
      </div>

      {synced && (
        <p className="flex items-start gap-2 text-xs text-emerald-400 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
          <Check size={13} strokeWidth={2} className="mt-px shrink-0" />
          <span>
            Déjà synchronisée. Tu peux continuer à capturer : les nouveaux
            éléments s&apos;ajouteront au carnet existant, sans toucher à sa mise en page.
          </span>
        </p>
      )}
      {/* Capture — disponible aussi sur une visite déjà synchronisée */}
      <>
          {/* Capture */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => cameraRef.current?.click()}
              className="flex flex-col items-center gap-1.5 py-4 rounded-xl border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <Camera size={20} strokeWidth={1.6} />
              <span className="text-xs">Photo</span>
            </button>
            <button
              onClick={() => setRecorderOpen(true)}
              className="flex flex-col items-center gap-1.5 py-4 rounded-xl border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <Mic size={20} strokeWidth={1.6} />
              <span className="text-xs">Mémo vocal</span>
            </button>
            <button
              onClick={() => setNoteOpen(true)}
              className="flex flex-col items-center gap-1.5 py-4 rounded-xl border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <Type size={20} strokeWidth={1.6} />
              <span className="text-xs">Note</span>
            </button>
            <button
              onClick={() => galerieRef.current?.click()}
              className="flex flex-col items-center gap-1.5 py-4 rounded-xl border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <ImageIcon size={20} strokeWidth={1.6} />
              <span className="text-xs">Galerie</span>
            </button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden
            onChange={(e) => addPhotos(e.target.files)} />
          <input ref={galerieRef} type="file" accept="image/*" multiple hidden
            onChange={(e) => addPhotos(e.target.files)} />
      </>

      {busy && (
        <p className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Loader2 size={13} className="animate-spin" strokeWidth={2} /> {busy}
        </p>
      )}

      {/* Contenu capturé */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-2">
        <p className="text-xs text-[var(--text-primary)]">
          {visit.blocks.length === 0
            ? "Rien de capturé pour l'instant."
            : `${compte.photo} photo${compte.photo > 1 ? "s" : ""} · ${compte.memo} mémo${compte.memo > 1 ? "s" : ""} · ${compte.note} note${compte.note > 1 ? "s" : ""}`}
        </p>
        {visit.blocks.length > 0 && (
          <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
            Tout est conservé sur l&apos;appareil. La visite partira d&apos;un bloc dès que
            le serveur répondra — dans l&apos;ordre de capture.
          </p>
        )}
      </div>

      {/* Modules du carnet — mêmes formulaires qu'en ligne */}
      <div className="space-y-2">
        <button
          onClick={() => setPickerOpen(true)}
          className="w-full py-3 rounded-xl border-2 border-dashed border-[var(--border-default)] text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)] transition-colors"
        >
          + Ajouter un module
        </button>
        {modules.length > 0 && (
          <ul className="space-y-1.5">
            {modules.map((b) => (
              <li key={b.localId}>
                <button
                  onClick={() => setEditing(b.localId)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] transition-colors text-left"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-[var(--text-primary)] truncate">
                      {String(
                        b.payload?.artworkTitle || b.payload?.eventName ||
                        b.payload?.title || b.payload?.label || "Sans titre",
                      ) || "Sans titre"}
                    </span>
                    <span className="block text-[10px] text-[var(--text-tertiary)] capitalize">{b.type}</span>
                  </span>
                  <Pencil size={13} strokeWidth={1.9} className="text-[var(--text-tertiary)] shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pickerOpen && (
        <BlockTypeModal
          onClose={() => setPickerOpen(false)}
          onSelectText={() => { setPickerOpen(false); setNoteOpen(true); }}
          onSelectAudio={() => { setPickerOpen(false); setRecorderOpen(true); }}
          onSelectHighlight={() => ajouterModule("highlight")}
          onSelectChecklist={() => ajouterModule("checklist")}
          onSelectTimeline={() => ajouterModule("timeline")}
          onSelectCartel={() => ajouterModule("cartel")}
          onSelectTicket={() => ajouterModule("ticket")}
          onSelectPalette={() => ajouterModule("palette")}
          onSelectSeparator={() => ajouterModule("separator")}
          onSelectSketch={() => setPickerOpen(false)}
          // Types intrinsèquement distants : le sélecteur les grise déjà, ces
          // rappels ne peuvent donc pas être déclenchés hors ligne.
          onSelectEmbed={() => setPickerOpen(false)}
          onSelectMap={() => setPickerOpen(false)}
          onSelectArtist={() => setPickerOpen(false)}
        />
      )}

      {/* Édition d'un module : LE formulaire de l'app, pas une copie. */}
      <TileSettingsModal
        tile={tuileEnEdition}
        isMobile
        onClose={() => setEditing(null)}
        onDelete={(t) => supprimerModule(t.id)}
        onSaveHighlight={(id, title, rating, note) => majModule(id, { title, rating, note: note.trim() || null })}
        onSaveChecklist={(id, title, items) => majModule(id, { title: title.trim() || null, items })}
        onSaveTimeline={(id, title, events) => majModule(id, { title: title.trim() || null, events })}
        onSaveCartel={(id, v: CartelFormValues) => majModule(id, {
          artworkTitle: v.artworkTitle, artist: v.artist.trim() || null, dateText: v.dateText.trim() || null,
          medium: v.medium.trim() || null, dimensions: v.dimensions.trim() || null,
          room: v.room.trim() || null, notes: v.notes.trim() || null,
        })}
        onSaveTicket={(id, v: TicketFormValues) => majModule(id, {
          eventName: v.eventName, place: v.place.trim() || null, dateText: v.dateText.trim() || null,
          price: v.price.trim() || null, category: v.category.trim() || null,
        })}
        onSavePalette={(id, title, colors) => majModule(id, { title: title.trim() || null, colors })}
        onSaveSeparator={(id, label) => majModule(id, { label })}
        // Sans objet hors ligne : formats et médias se règlent une fois en ligne.
        onSetFormat={() => {}}
        onSaveText={() => {}}
        onPersistText={async () => {}}
        onSaveImage={() => {}}
        onSetImageShowTitle={() => {}}
        onSetFitContain={() => {}}
        onSetFicheFlags={() => {}}
        onSaveEmbed={() => {}}
        onSaveMap={() => {}}
        onUploadTicketPhoto={async () => {}}
        onUploadPaletteSource={async () => {}}
        onRedrawSketch={() => {}}
      />

      {/* Saisie d'une note */}
      {noteOpen && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setNoteOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-[var(--text-primary)]">Note</p>
            <textarea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={6}
              placeholder="Ce que tu veux retenir…"
              className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)] resize-y"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setNoteOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                Annuler
              </button>
              <button onClick={addNote}
                className="px-3 py-1.5 rounded-lg text-xs bg-[var(--text-primary)] text-[var(--bg-base)]">
                Ajouter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Enregistreur — mode tâche de fond : il remonte le clip brut, sans
          transcription ni upload (le modèle Whisper n'est de toute façon pas
          téléchargeable hors ligne ; la transcription se fera une fois en ligne). */}
      <VoiceMemoRecorder open={recorderOpen} onClose={() => setRecorderOpen(false)} onRecorded={addMemo} />
    </div>
  );
}
