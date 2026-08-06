"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, Mic, Type, Image as ImageIcon, Check, Loader2 } from "lucide-react";
import { VoiceMemoRecorder } from "@/components/visits/VoiceMemoRecorder";
import { SketchPad } from "@/components/visits/bento/SketchPad";
import { compressImageForUpload } from "@/lib/image/clientResize";
import { BlockTypeModal } from "@/components/visits/BlockTypeModal";
import { TileSettingsModal, type CartelFormValues, type TicketFormValues } from "@/components/visits/bento/TileSettingsModal";
import { BentoGrid } from "@/components/visits/bento/BentoGrid";
import { useSortableGrid } from "@/hooks/useSortableGrid";
import {
  isAutoHeight, isFicheContent, tileKey,
  type TileWidth,
} from "@/lib/visits/bentoSpans";
import type { BentoTile, ChecklistItem } from "@/lib/visits/bentoTypes";
import { useBlobUrls } from "@/lib/offline/useBlobUrls";
import { tuilesLocales } from "@/lib/offline/localTiles";
import {
  appendLocalBlock, patchLocalBlock, removeLocalBlock, attachLocalFile,
  setLocalLayout, setLocalNote, type LocalBlock, type LocalVisit,
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
  const [sketchOpen, setSketchOpen] = useState(false);
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

  // Fichier d'un module (photo de billet, image source d'une palette). Il est
  // rangé À PART du payload : celui-ci part en JSON à la synchro, où un Blob
  // deviendrait `{}`. Il est envoyé sur la sous-route du module, après que
  // celui-ci existe côté serveur.
  const joindreFichier = async (blockId: string, file: File) => {
    const blob = await compressImageForUpload(file);
    const maj = await attachLocalFile(
      visit.localId, blockId, "photo", blob, blob.name || `module-${Date.now()}.jpg`,
    );
    if (maj) onChange(maj);
  };

  const supprimerModule = async (blockId: string) => {
    const maj = await removeLocalBlock(visit.localId, blockId);
    if (maj) onChange(maj);
    setEditing(null);
  };

  // ── Le carnet, en tuiles ─────────────────────────────────────────────────
  const urls = useBlobUrls(visit.blocks);
  const tuiles = useMemo(() => tuilesLocales(visit, urls), [visit, urls]);
  // Miroir des tuiles pour les rappels du glisser-déposer. Assigné dans un
  // EFFET (et non pendant le rendu) ; `onReorder` le met à jour lui-même, sans
  // quoi deux survols successifs pendant un même geste repartiraient tous deux
  // de l'état d'avant le premier.
  const tuilesRef = useRef(tuiles);
  useEffect(() => { tuilesRef.current = tuiles; }, [tuiles]);

  /** Écrit la disposition telle qu'elle est à l'écran. */
  const enregistrerDisposition = async (suivantes: BentoTile[]) => {
    const maj = await setLocalLayout(
      visit.localId,
      // `content` est DÉRIVÉ des blocs et ne doit pas être persisté ; tout le
      // reste l'est. Ne recopier que type/id/w/h perdrait les réglages portés
      // par la tuile (afficher le cartel, ratio d'origine, libellé de
      // séparateur) au premier réordonnancement venu.
      suivantes.map((t) => {
        const tuile: Record<string, unknown> = { ...t, id: String(t.id) };
        delete tuile.content;
        return tuile as NonNullable<LocalVisit["layout"]>[number];
      }),
    );
    if (maj) onChange(maj);
  };

  /** Bascule un drapeau porté par la TUILE (et non par le bloc). */
  const basculerDrapeau = (id: string, cle: "showTitle" | "fitContain", valeur: boolean) => {
    void enregistrerDisposition(
      tuilesRef.current.map((t) => (String(t.id) === id ? { ...t, [cle]: valeur } : t)),
    );
  };

  const sortable = useSortableGrid({
    onReorder: (deKey, versKey) => {
      const liste = tuilesRef.current;
      const de = liste.findIndex((t) => tileKey(t) === deKey);
      const vers = liste.findIndex((t) => tileKey(t) === versKey);
      if (de < 0 || vers < 0 || de === vers) return;
      const copie = [...liste];
      const [bouge] = copie.splice(de, 1);
      copie.splice(vers, 0, bouge);
      tuilesRef.current = copie;
      void enregistrerDisposition(copie);
    },
    onDrop: () => {},
  });

  const definirFormat = (tile: BentoTile, w: TileWidth, h: 1 | 2) => {
    void enregistrerDisposition(
      tuilesRef.current.map((t) =>
        // Auto-hauteur (texte, checklist, frise) : seule la largeur se règle,
        // la hauteur suit le contenu. Même règle qu'en ligne.
        tileKey(t) === tileKey(tile)
          ? { ...t, w, h: isAutoHeight(t.type) || isFicheContent(t.content) ? t.h : h }
          : t,
      ),
    );
  };

  const definirHauteurAuto = (tile: BentoTile, rows: number) => {
    if (tile.h === rows) return;
    void enregistrerDisposition(
      tuilesRef.current.map((t) => (tileKey(t) === tileKey(tile) ? { ...t, h: rows } : t)),
    );
  };

  const majNote = async (blockId: string, contenu: string) => {
    const maj = await setLocalNote(visit.localId, blockId, contenu);
    if (maj) onChange(maj);
  };

  const basculerChecklist = (checklistId: string, itemId: string) => {
    const bloc = visit.blocks.find((b) => b.localId === checklistId);
    const items = Array.isArray(bloc?.payload?.items)
      ? (bloc!.payload!.items as ChecklistItem[]) : [];
    void majModule(checklistId, {
      items: items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)),
    });
  };

  // La tuile en réglages vient de la GRILLE, pas d'une reconstruction : la
  // version précédente repartait d'une table qui ne connaissait que les
  // modules, donc les réglages d'une photo ou d'un croquis ne s'ouvraient
  // jamais (signalé le 2026-08-06).
  const tuileEnEdition = tuiles.find((t) => String(t.id) === editing) ?? null;


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

      {/* LE CARNET — exactement la grille de la version en ligne.
          Les mêmes composants (BentoGrid / BentoTile / TileContent) sont
          alimentés par les blocs locaux : les fichiers passent en URL d'objet
          là où le rendu attend une clé R2. Il n'y a donc AUCUNE interface
          parallèle à maintenir, et rien à réapprendre en passant hors ligne
          (demande utilisateur 2026-08-06). */}
      <BentoGrid
        tiles={tuiles}
        editable
        sortable={sortable}
        isMobile
        selectedKey={editing}
        onSetFormat={definirFormat}
        onOpenSettings={(t) => setEditing(String(t.id))}
        onSaveText={(t, v) => void majNote(String(t.id), v)}
        onPersistText={async (t, v) => { await majNote(String(t.id), v); }}
        onToggleChecklistItem={basculerChecklist}
        onAutoRows={definirHauteurAuto}
        onAddClick={() => setPickerOpen(true)}
      />

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
          onSelectSketch={() => { setPickerOpen(false); setSketchOpen(true); }}
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
        onSaveImage={(id, title, author, year) => majModule(id, {
          title: title.trim(), author: author.trim() || null,
          year: year.trim() ? Number(year) : null,
        })}
        onSetImageShowTitle={(id, show) => basculerDrapeau(id, "showTitle", show)}
        onSetFitContain={(id, fit) => basculerDrapeau(id, "fitContain", fit)}
        onSetFicheFlags={() => {}}
        onSaveEmbed={() => {}}
        onSaveMap={() => {}}
        onUploadTicketPhoto={(id, file) => joindreFichier(id, file)}
        onUploadPaletteSource={(id, file) => joindreFichier(id, file)}
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
      <SketchPad
          open={sketchOpen}
          onClose={() => setSketchOpen(false)}
          onSave={async (blob) => {
            setSketchOpen(false);
            const maj = await appendLocalBlock(visit.localId, {
              type: "sketch", blob, filename: `croquis-${Date.now()}.png`,
            });
            if (maj) onChange(maj);
          }}
        />

      <VoiceMemoRecorder open={recorderOpen} onClose={() => setRecorderOpen(false)} onRecorded={addMemo} />
    </div>
  );
}
