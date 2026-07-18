"use client";

import { MapPin } from "lucide-react";
import { VisitMap } from "@/components/visits/VisitMap";

interface MapTileProps {
  locationName: string;
  latitude: number;
  longitude: number;
  className?: string;
}

// Repli si le contour du pays ne peut pas être chargé : un zoom « pays »
// (large) pour quand même situer le lieu dans sa région.
const FALLBACK_ZOOM = 5;

// Tuile carte — cadre sur le PAYS du lieu (contour tracé) pour visualiser où
// il se situe dans le pays (demande utilisateur 2026-07-18), en version
// décorative (pas de pan/zoom, conflit avec le drag de la tuile).
export function MapTile({ locationName, latitude, longitude, className }: MapTileProps) {
  return (
    // isolation: isolate → contexte d'empilement propre à la tuile : sans lui,
    // le z-index élevé de l'étiquette (et des calques Leaflet) « fuyait » et
    // passait au-dessus des pop-ups de l'app (bug 2026-07-18).
    <div className={className} style={{ position: "relative", isolation: "isolate" }}>
      <VisitMap
        latitude={latitude}
        longitude={longitude}
        zoom={FALLBACK_ZOOM}
        interactive={false}
        countryOutline
        className="absolute inset-0"
      />
      {/* Étiquette du lieu — au-dessus des calques Leaflet, mais confinée par
          l'isolation ci-dessus. */}
      <div className="pointer-events-none absolute top-2 left-2 right-2 z-[500] flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 backdrop-blur-md bg-black/45">
        <MapPin size={12} strokeWidth={2} className="text-white/80 flex-shrink-0" />
        <p className="text-[12px] font-medium text-white truncate">{locationName}</p>
      </div>
    </div>
  );
}
