"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

interface VisitMapProps {
  latitude: number;
  longitude: number;
  /** Libellé de la popup (nom du lieu) */
  label?: string;
  className?: string;
}

// Mini-carte Leaflet + tuiles CARTO dark (assorties au thème sombre).
// Leaflet est importé dynamiquement dans useEffect : il touche `window`
// au chargement et casserait le rendu SSR sinon.
export function VisitMap({ latitude, longitude, label, className }: VisitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: [latitude, longitude],
        zoom: 15,
        zoomControl: false,
        scrollWheelZoom: false, // ne pas voler le scroll de la page
        dragging: true,
        attributionControl: true,
      });
      mapRef.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 19,
        },
      ).addTo(map);

      // Marqueur en divIcon (pas d'assets PNG Leaflet à configurer)
      const icon = L.divIcon({
        className: "",
        html: '<div style="width:14px;height:14px;border-radius:50%;background:#e8e0d4;border:3px solid rgba(10,10,10,0.8);box-shadow:0 0 0 2px rgba(232,224,212,0.35)"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const marker = L.marker([latitude, longitude], { icon }).addTo(map);
      if (label) marker.bindPopup(label);

      L.control.zoom({ position: "bottomright" }).addTo(map);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude, label]);

  return (
    <div
      ref={containerRef}
      className={className}
      // isolation: isolate — Leaflet's internal panes/controls use z-index up
      // to 1000, which otherwise escapes to compete with unrelated overlays
      // elsewhere on the page (e.g. the portaled fullscreen image viewer at
      // z-[200]) since the map container itself doesn't establish a stacking
      // context on its own. This contains Leaflet's z-indices to the map box.
      style={{ background: "var(--bg-surface)", isolation: "isolate" }}
    />
  );
}
