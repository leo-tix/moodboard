"use client";

import { MapPin } from "lucide-react";
import { VisitMap } from "@/components/visits/VisitMap";

interface MapTileProps {
  locationName: string;
  latitude: number;
  longitude: number;
  className?: string;
}

// Zoom volontairement large : à 15 (le niveau de la carte de couverture) la
// tuile ne montrait qu'un pâté de maisons anonyme, sans rien pour situer le
// lieu. À 13 on lit le quartier et les repères alentour, ce qui est tout
// l'intérêt d'une vignette de carte (retour utilisateur 2026-07-17).
const TILE_ZOOM = 13;

// Tuile carte — réutilise le rendu Leaflet de VisitMap.tsx, en version
// décorative : pas de pan/zoom (le geste entrait en conflit avec le drag de
// la tuile) ni de boutons +/− (encombrants sur 200px de haut). Le clic ouvre
// le panneau d'édition, comme les autres tuiles sans action propre.
export function MapTile({ locationName, latitude, longitude, className }: MapTileProps) {
  return (
    <div className={className} style={{ position: "relative" }}>
      <VisitMap
        latitude={latitude}
        longitude={longitude}
        zoom={TILE_ZOOM}
        interactive={false}
        className="absolute inset-0"
      />
      {/* Étiquette en HAUT : posée en bas, elle recouvrait l'attribution
          OpenStreetMap/CARTO, qui doit rester lisible (exigence de licence).
          Vibrance (spec §5) : fond semi-transparent + flou pour rester lisible
          sur n'importe quelle tuile de carte. */}
      <div className="pointer-events-none absolute top-2 left-2 right-2 z-[500] flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 backdrop-blur-md bg-black/45">
        <MapPin size={12} strokeWidth={2} className="text-white/80 flex-shrink-0" />
        <p className="text-[12px] font-medium text-white truncate">{locationName}</p>
      </div>
    </div>
  );
}
