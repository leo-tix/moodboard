"use client";

import { VisitMap } from "@/components/visits/VisitMap";

interface MapTileProps {
  locationName: string;
  latitude: number;
  longitude: number;
  className?: string;
}

// Tuile carte — réutilise le rendu Leaflet de VisitMap.tsx (carte globale de
// la visite) tel quel, avec une superposition du nom du lieu façon spec
// bento §5 (Vibrance : backdrop-blur + fond semi-transparent).
export function MapTile({ locationName, latitude, longitude, className }: MapTileProps) {
  return (
    <div className={className} style={{ position: "relative" }}>
      <VisitMap latitude={latitude} longitude={longitude} label={locationName} className="absolute inset-0" />
      <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-[500] rounded-lg px-2.5 py-1.5 backdrop-blur-md bg-black/40">
        <p className="text-[12px] font-medium text-white truncate">{locationName}</p>
      </div>
    </div>
  );
}
