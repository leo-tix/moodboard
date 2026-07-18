"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { getThumbnailUrl } from "@/lib/storage/urls";

interface VisitMapProps {
  latitude: number;
  longitude: number;
  /** Libellé de la popup (nom du lieu) */
  label?: string;
  /** Vignette mise en avant dans le pin (même style que la carte cumulée) — à défaut, simple point. */
  thumbnailKey?: string | null;
  /** Niveau de zoom Leaflet. 15 ≈ la rue ; plus bas = plus de contexte alentour. */
  zoom?: number;
  /**
   * `false` : carte décorative, non manipulable (ni glisser, ni zoom, ni
   * contrôles). Utilisé par la tuile bento du carnet — s'y ajoutait sinon un
   * conflit de geste (le pan de Leaflet luttait avec le drag de la tuile) et
   * les boutons +/− encombraient une vignette de 200px de haut.
   */
  interactive?: boolean;
  /**
   * Trace le contour du PAYS contenant le point et cadre la carte dessus
   * (pour visualiser où le lieu se situe dans le pays — demande utilisateur
   * 2026-07-18). Frontière administrative OSM via reverse-geocoding Nominatim.
   * Repli silencieux sur `zoom` si indisponible.
   */
  countryOutline?: boolean;
  className?: string;
}

// Mini-carte Leaflet + tuiles CARTO dark (assorties au thème sombre).
// Leaflet est importé dynamiquement dans useEffect : il touche `window`
// au chargement et casserait le rendu SSR sinon.
// Ray-casting : le point (lng,lat) est-il dans l'anneau extérieur ?
function ringContains(ring: number[][], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Une frontière de pays OSM est souvent un MultiPolygon incluant les
// territoires lointains (France + DOM-TOM, etc.) : cadrer sur l'ensemble
// dézoome jusqu'au monde entier (bug Bordeaux 2026-07-18). On ne garde que le
// polygone qui CONTIENT le point (→ France métropolitaine pour Bordeaux), avec
// repli sur le plus grand polygone si aucun ne le contient.
function pickContainingPolygon(geojson: { type?: string; coordinates?: unknown }, lng: number, lat: number) {
  if (!geojson || geojson.type !== "MultiPolygon" || !Array.isArray(geojson.coordinates)) return geojson;
  const polys = geojson.coordinates as number[][][][];
  for (const poly of polys) {
    if (poly[0] && ringContains(poly[0], lng, lat)) return { type: "Polygon", coordinates: poly };
  }
  let best: number[][][] | null = null, bestArea = -1;
  for (const poly of polys) {
    const r = poly[0];
    if (!r) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of r) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const area = (maxX - minX) * (maxY - minY);
    if (area > bestArea) { bestArea = area; best = poly; }
  }
  return best ? { type: "Polygon", coordinates: best } : geojson;
}

export function VisitMap({ latitude, longitude, label, thumbnailKey, zoom = 15, interactive = true, countryOutline = false, className }: VisitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  // Cadre à restaurer après un redimensionnement du conteneur (contour pays).
  const fitBoundsRef = useRef<import("leaflet").LatLngBounds | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: [latitude, longitude],
        zoom,
        zoomControl: false,
        scrollWheelZoom: false, // ne pas voler le scroll de la page
        dragging: interactive,
        touchZoom: interactive,
        doubleClickZoom: interactive,
        keyboard: interactive,
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

      // Pin-photo (même style que VisitsGlobalMap) si une vignette est
      // disponible, sinon simple point — "carte premium" plutôt qu'un point uni.
      const thumb = thumbnailKey ? getThumbnailUrl(thumbnailKey) : null;
      const icon = thumb
        ? L.divIcon({
            className: "",
            html: `<div style="width:52px;height:52px;border-radius:50%;overflow:hidden;border:3px solid #e8e0d4;box-shadow:0 4px 14px rgba(0,0,0,0.55)"><img src="${thumb}" style="width:100%;height:100%;object-fit:cover" /></div>`,
            iconSize: [52, 52],
            iconAnchor: [26, 26],
          })
        : L.divIcon({
            className: "",
            html: '<div style="width:14px;height:14px;border-radius:50%;background:#e8e0d4;border:3px solid rgba(10,10,10,0.8);box-shadow:0 0 0 2px rgba(232,224,212,0.35)"></div>',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
      const marker = L.marker([latitude, longitude], { icon }).addTo(map);
      if (label && interactive) marker.bindPopup(label);

      if (interactive) L.control.zoom({ position: "bottomright" }).addTo(map);

      // Contour du pays + cadrage dessus. Best-effort : la frontière
      // administrative OSM est récupérée par reverse-geocoding Nominatim
      // (zoom=3 = niveau pays, polygon_geojson=1). En cas d'échec (réseau,
      // limite de débit, pays introuvable) on garde le zoom par défaut.
      if (countryOutline) {
        try {
          const cacheKey = `mb:country:${latitude.toFixed(1)},${longitude.toFixed(1)}`;
          let geojson: unknown = null;
          const cached = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(cacheKey) : null;
          if (cached) {
            geojson = JSON.parse(cached);
          } else {
            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=jsonv2&zoom=3&polygon_geojson=1&polygon_threshold=0.02&accept-language=fr`,
            );
            const data = await res.json();
            geojson = data?.geojson ?? null;
            if (geojson) try { sessionStorage.setItem(cacheKey, JSON.stringify(geojson)); } catch { /* quota */ }
          }
          if (!cancelled && geojson && mapRef.current) {
            // Ne garder que le polygone contenant le lieu (ex. métropole pour
            // Bordeaux), pas les territoires lointains.
            const shape = pickContainingPolygon(geojson as { type?: string; coordinates?: unknown }, longitude, latitude);
            const layer = L.geoJSON(shape as GeoJSON.GeoJsonObject, {
              interactive: false,
              style: { color: "#e8e0d4", weight: 1.5, opacity: 0.7, fillColor: "#e8e0d4", fillOpacity: 0.05 },
            }).addTo(map);
            const b = layer.getBounds();
            if (b.isValid()) { fitBoundsRef.current = b; map.fitBounds(b, { padding: [14, 14] }); }
          }
        } catch {
          /* garde le centre/zoom par défaut */
        }
      }

      // Le conteneur change de taille quand la tuile change de format : sans
      // invalidateSize(), Leaflet reste dimensionné pour l'ancienne taille et
      // la carte apparaît décalée jusqu'au rafraîchissement (bug 2026-07-18).
      // On resynchronise et on re-cadre sur le pays le cas échéant.
      if (containerRef.current) {
        ro = new ResizeObserver(() => {
          const mp = mapRef.current;
          if (!mp) return;
          mp.invalidateSize({ animate: false });
          if (fitBoundsRef.current?.isValid()) mp.fitBounds(fitBoundsRef.current, { padding: [14, 14] });
        });
        ro.observe(containerRef.current);
      }
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude, label, thumbnailKey, zoom, interactive, countryOutline]);

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
