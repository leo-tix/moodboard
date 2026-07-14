"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Image as ImageIcon, Mic, Camera, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { compressImageForUpload } from "@/lib/image/clientResize";
import { enqueueCapture, OUTBOX_SYNCED_EVENT } from "@/lib/offline/outbox";
import { VoiceMemoRecorder, type CreatedAudioBlock } from "@/components/visits/VoiceMemoRecorder";

const LONG_PRESS_MS = 450;

// FAB de capture "friction zéro" (Phase 1 mobile du plan Assistant de Visite) :
// - **Tap** → ouvre un petit menu à 3 choix (galerie / micro / appareil
//   photo) — zoning UI du 2026-07-13, remplace l'ancien tap = appareil
//   photo direct.
// - **Appui long** → INCHANGÉ, raccourci direct vers le mémo vocal (ne passe
//   pas par le menu) : ouvre VoiceMemoRecorder (waveform + transcription en
//   direct + repli local + file hors ligne — composant partagé avec TOUS
//   les autres points d'entrée audio du carnet, voir VoiceMemoRecorder.tsx).
export function VisitCaptureFab({ visitId }: { visitId: string }) {
  const router = useRouter();
  // Deux inputs distincts : la galerie (pas de `capture`, l'utilisateur
  // choisit des photos existantes) et l'appareil photo (`capture="environment"`,
  // force la prise de vue) — même pipeline d'upload derrière les deux.
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const fabButtonRef = useRef<HTMLButtonElement>(null);
  const [memoOpen, setMemoOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Message neutre (capture mise en file hors ligne) — distinct de `error`.
  const [info, setInfo] = useState<string | null>(null);

  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  useEffect(() => () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
  }, []);

  // Ferme le menu d'actions au clic/tap en dehors (le bouton FAB lui-même
  // gère son propre toggle via onFabPointerUp, exclu ici pour ne pas
  // rouvrir immédiatement ce qu'il vient de fermer).
  useEffect(() => {
    if (!actionMenuOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      const insideMenu = actionMenuRef.current?.contains(target);
      const onFabButton = fabButtonRef.current?.contains(target);
      if (!insideMenu && !onFabButton) setActionMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [actionMenuOpen]);

  // Une capture rejouée depuis la file hors ligne vient d'atterrir côté serveur
  // → rafraîchir le carnet pour la faire apparaître (offline-first Phase 4).
  useEffect(() => {
    const onSynced = (e: Event) => {
      const detail = (e as CustomEvent<{ visitId: string }>).detail;
      if (!detail || detail.visitId === visitId) router.refresh();
    };
    window.addEventListener(OUTBOX_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OUTBOX_SYNCED_EVENT, onSynced);
  }, [visitId, router]);

  // Auto-effacement du message neutre "en attente de connexion".
  useEffect(() => {
    if (!info) return;
    const t = window.setTimeout(() => setInfo(null), 4000);
    return () => window.clearTimeout(t);
  }, [info]);

  // ── Photo (tap) ──
  const handlePhotoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingPhoto(true);
    setError(null);
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    try {
      // Une photo caméra brute dépasse souvent la limite serveur (10 Mo) —
      // compression/ré-encodage local AVANT tout (aussi bien pour l'envoi direct
      // que pour la mise en file, où l'on stocke déjà le blob compressé).
      const compressed = await Promise.all(Array.from(files).map((f) => compressImageForUpload(f)));

      // Hors ligne : mettre en file, ne rien perdre. Le rejeu se fera au retour
      // du réseau (voir lib/offline/outbox.ts).
      if (offline) {
        for (const [i, blob] of compressed.entries()) {
          await enqueueCapture({
            kind: "photo",
            visitId,
            blob,
            filename: `photo-${Date.now()}-${i}.jpg`,
          });
        }
        setInfo(
          `${compressed.length} photo${compressed.length > 1 ? "s" : ""} en attente de connexion — envoi automatique au retour du réseau.`,
        );
        return;
      }

      const ids: string[] = [];
      for (const [i, uploadFile] of compressed.entries()) {
        try {
          const fd = new FormData();
          fd.append("file", uploadFile);
          const res = await fetch("/api/upload/image", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          // ⚠ l'API renvoie `inspirationId`, pas `id` — lire le mauvais champ
          // affichait "Échec de l'upload" alors que l'image était bien créée
          // (retrouvée en triage), et le rattachement ne partait jamais.
          if (res.ok && data.inspirationId) ids.push(data.inspirationId);
          else throw new Error(data.error ?? "upload");
        } catch {
          // Échec réseau en cours d'upload (pas un vrai hors-ligne franc, mais
          // un blip) : plutôt que d'abandonner, mettre en file pour rejeu.
          await enqueueCapture({
            kind: "photo",
            visitId,
            blob: uploadFile,
            filename: `photo-${Date.now()}-${i}.jpg`,
          });
          setInfo("Réseau instable — photo mise en file, envoi automatique dès que possible.");
        }
      }
      if (ids.length > 0) {
        // L'image est déjà créée (visible en triage) à ce stade — sans
        // vérifier cette réponse, un échec réseau (fréquent en wifi musée)
        // laissait l'image orpheline : uploadée mais jamais rattachée à la
        // visite, invisible dans le carnet, seulement retrouvable en triage.
        // Un essai de secours avant d'abandonner (le premier échec est
        // souvent un simple blip réseau).
        const attach = () =>
          fetch(`/api/visits/${visitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ addInspirationIds: ids }),
          });
        let res = await attach();
        if (!res.ok) res = await attach();
        if (!res.ok) {
          setError(
            `${ids.length > 1 ? "Photos envoyées" : "Photo envoyée"} mais pas rattachée à la visite (réseau instable ?) — elle${ids.length > 1 ? "s restent" : " reste"} disponible${ids.length > 1 ? "s" : ""} en triage.`
          );
        } else {
          router.refresh();
        }
      }
    } finally {
      setUploadingPhoto(false);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  // ── Mémo vocal (appui long ou bouton micro du menu) ──
  const handleMemoCreated = (_audio: CreatedAudioBlock) => {
    router.refresh();
  };

  // ── Gestion tap vs appui long sur le FAB ──
  // Tap → ouvre/ferme le petit menu (galerie/micro/appareil photo). Appui
  // long → INCHANGÉ, raccourci direct vers le mémo vocal, ne passe jamais
  // par le menu (démarre avant même que le tap n'ait eu la chance de
  // s'exécuter, via longPressFired).
  const onFabPointerDown = () => {
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      navigator.vibrate?.(15);
      setActionMenuOpen(false);
      setMemoOpen(true);
    }, LONG_PRESS_MS);
  };
  const onFabPointerUp = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    if (!longPressFired.current && !memoOpen && !uploadingPhoto) {
      setActionMenuOpen((v) => !v);
    }
  };
  const onFabPointerLeave = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
  };

  // ── Actions du menu (galerie / micro / appareil photo) ──
  const openGallery = () => { setActionMenuOpen(false); galleryInputRef.current?.click(); };
  const openCamera = () => { setActionMenuOpen(false); cameraInputRef.current?.click(); };
  const openMicFromMenu = () => { setActionMenuOpen(false); setMemoOpen(true); };

  return (
    <>
      {/* Galerie : pas de `capture`, l'utilisateur choisit des photos déjà
          existantes sur son appareil. */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handlePhotoFiles(e.target.files)}
      />
      {/* Appareil photo : `capture` force la prise de vue native. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => handlePhotoFiles(e.target.files)}
      />

      {/* Menu d'actions (galerie / micro / appareil photo) — ouvert par un
          simple tap sur le FAB, zoning UI du 2026-07-13. L'appui long reste
          un raccourci direct vers le mémo vocal, sans jamais passer par ce
          menu (voir onFabPointerDown). */}
      <AnimatePresence>
        {actionMenuOpen && (
          <motion.div
            ref={actionMenuRef}
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ type: "tween", duration: 0.15, ease: [0.2, 0, 0, 1] }}
            className="fixed left-1/2 -translate-x-1/2 z-[66] bottom-[calc(8.75rem+env(safe-area-inset-bottom))] md:bottom-[10.25rem] flex flex-col items-center gap-2.5"
          >
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={openGallery}
                title="Choisir dans la galerie"
                className="w-12 h-12 rounded-full flex items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl text-[var(--text-primary)] active:scale-95 transition-transform"
              >
                <ImageIcon size={20} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={openMicFromMenu}
                title="Mémo vocal"
                className="w-12 h-12 rounded-full flex items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl text-[var(--text-primary)] active:scale-95 transition-transform"
              >
                <Mic size={20} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={openCamera}
                title="Prendre une photo"
                className="w-12 h-12 rounded-full flex items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl text-[var(--text-primary)] active:scale-95 transition-transform"
              >
                <Camera size={20} strokeWidth={1.75} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setActionMenuOpen(false)}
              title="Fermer"
              className="w-9 h-9 rounded-full flex items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl text-[var(--text-tertiary)] hover:text-[var(--text-primary)] active:scale-95 transition-transform"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAB — au-dessus de la BottomNav mobile (h-14) + safe area */}
      <button
        ref={fabButtonRef}
        type="button"
        onPointerDown={onFabPointerDown}
        onPointerUp={onFabPointerUp}
        onPointerLeave={onFabPointerLeave}
        // iOS peut interrompre la séquence pointer (gesture système) — sans
        // ça le timer d'appui long resterait armé et déclencherait un mémo
        // fantôme après coup.
        onPointerCancel={onFabPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
        title="Ajouter (appui long : mémo vocal)"
        className={cn(
          "fixed left-1/2 -translate-x-1/2 z-[65] w-14 h-14 rounded-full flex items-center justify-center",
          // Mobile : au-dessus de la BottomNav (h-14) + safe area ; desktop : bas-centre
          "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6",
          "bg-[var(--text-primary)] text-[var(--bg-base)] shadow-2xl shadow-black/50",
          "active:scale-95 transition-transform select-none touch-none",
          uploadingPhoto && "opacity-70 pointer-events-none"
        )}
        style={{ WebkitTouchCallout: "none" }}
      >
        {uploadingPhoto ? (
          <span className="w-5 h-5 border-2 border-[var(--bg-base)] border-t-transparent rounded-full animate-spin" />
        ) : (
          <Plus size={24} strokeWidth={2} />
        )}
      </button>

      {error && !memoOpen && (
        <div className="fixed inset-x-4 z-[65] md:left-auto md:right-6 md:w-72" style={{ bottom: "calc(11rem + env(safe-area-inset-bottom))" }}>
          <div className="rounded-lg bg-[var(--bg-elevated)] border border-red-500/30 px-3 py-2 text-xs text-red-400 shadow-xl flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-[var(--text-tertiary)]">✕</button>
          </div>
        </div>
      )}

      {info && !memoOpen && (
        <div className="fixed inset-x-4 z-[65] md:left-auto md:right-6 md:w-72" style={{ bottom: "calc(11rem + env(safe-area-inset-bottom))" }}>
          <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-xl flex items-start gap-2">
            <span className="flex-1">{info}</span>
            <button onClick={() => setInfo(null)} className="text-[var(--text-tertiary)]">✕</button>
          </div>
        </div>
      )}

      <VoiceMemoRecorder
        visitId={visitId}
        open={memoOpen}
        onClose={() => setMemoOpen(false)}
        onCreated={handleMemoCreated}
        onInfo={setInfo}
      />
    </>
  );
}
