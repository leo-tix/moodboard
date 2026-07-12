"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";

export interface GlobalMapVisit {
  id: string;
  place: string;
  exhibition: string | null;
  visitDate: string;
  latitude: number | null;
  longitude: number | null;
  count: number;
  thumbnailKey: string | null;
}

// Carte cumulée de toutes les visites géolocalisées — pins-photo + clustering
// (façon Google Photos), avec un carrousel bas synchronisé (façon Apple
// Plans/Maps : cliquer un pin fait défiler le carrousel jusqu'à sa carte,
// et faire défiler le carrousel recentre la carte).
export function VisitsGlobalMap({ visits }: { visits: GlobalMapVisit[] }) {
  const geo = visits.filter(
    (v): v is GlobalMapVisit & { latitude: number; longitude: number } =>
      v.latitude !== null && v.longitude !== null
  );
  const ungeo = visits.filter((v) => v.latitude === null || v.longitude === null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const cardRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showUngeo, setShowUngeo] = useState(false);
  // Le scroll programmatique (déclenché par un clic sur un pin) ne doit pas
  // re-déclencher l'IntersectionObserver qui recentre la carte — sinon les
  // deux mécanismes s'auto-alimentent en boucle.
  const programmaticScrollRef = useRef(false);

  const focusVisit = (id: string, flyMap: boolean) => {
    setActiveId(id);
    const v = geo.find((g) => g.id === id);
    if (flyMap && v && mapRef.current) {
      mapRef.current.flyTo([v.latitude, v.longitude], Math.max(mapRef.current.getZoom(), 13), {
        duration: 0.6,
      });
    }
    const card = cardRefs.current.get(id);
    if (card) {
      programmaticScrollRef.current = true;
      card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      window.setTimeout(() => { programmaticScrollRef.current = false; }, 500);
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { default: L } = await import("leaflet");
      // leaflet.markercluster est un plugin UMD legacy : il s'attend à
      // trouver `L` en global au moment de son évaluation (il ne l'importe
      // pas lui-même). Sans cette assignation, son import échoue avec
      // "ReferenceError: L is not defined" sous un bundler ESM (Turbopack).
      (window as unknown as { L: typeof L }).L = L;
      await import("leaflet.markercluster");
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: geo.length > 0 ? [geo[0].latitude, geo[0].longitude] : [46.6, 2.4],
        zoom: geo.length > 0 ? 6 : 5,
        zoomControl: false,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);

      const clusterGroup = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        iconCreateFunction: (cluster) =>
          L.divIcon({
            className: "",
            html: `<div style="width:36px;height:36px;border-radius:50%;background:#1a1a1a;border:2px solid #e8e0d4;display:flex;align-items:center;justify-content:center;color:#f0f0f0;font-size:12px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.5)">${cluster.getChildCount()}</div>`,
            iconSize: [36, 36],
          }),
      });

      for (const v of geo) {
        const thumb = v.thumbnailKey ? getThumbnailUrl(v.thumbnailKey) : null;
        const icon = L.divIcon({
          className: "",
          html: thumb
            ? `<div style="width:44px;height:44px;border-radius:50%;overflow:hidden;border:2px solid #e8e0d4;box-shadow:0 4px 12px rgba(0,0,0,0.5)"><img src="${thumb}" style="width:100%;height:100%;object-fit:cover" /></div>`
            : `<div style="width:44px;height:44px;border-radius:50%;background:#1a1a1a;border:2px solid #e8e0d4"></div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        });
        const marker = L.marker([v.latitude, v.longitude], { icon });
        marker.on("click", () => focusVisit(v.id, true));
        clusterGroup.addLayer(marker);
      }
      map.addLayer(clusterGroup);

      if (geo.length > 0) {
        const bounds = L.latLngBounds(geo.map((v) => [v.latitude, v.longitude] as [number, number]));
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Le scroll du carrousel recentre la carte sur la carte la plus visible.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || geo.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (programmaticScrollRef.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = visible ? (visible.target as HTMLElement).dataset.visitId : undefined;
        if (id) focusVisit(id, true);
      },
      { root: scroller, threshold: [0.6] }
    );
    cardRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.length]);

  return (
    <div
      className="relative h-full w-full rounded-lg overflow-hidden border border-[var(--border-subtle)]"
      style={{ isolation: "isolate" }}
    >
      <div ref={containerRef} className="absolute inset-0" style={{ background: "var(--bg-surface)" }} />

      {ungeo.length > 0 && (
        <div className="absolute top-3 left-3 z-[500]">
          <button
            onClick={() => setShowUngeo((v) => !v)}
            className="px-2.5 py-1.5 text-xs rounded-full bg-[var(--bg-elevated)]/90 backdrop-blur-sm border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {ungeo.length} visite{ungeo.length !== 1 ? "s" : ""} non localisée{ungeo.length !== 1 ? "s" : ""}
          </button>
          {showUngeo && (
            <div className="mt-1.5 w-56 max-h-64 overflow-y-auto rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl">
              {ungeo.map((v) => (
                <Link
                  key={v.id}
                  href={`/visites/${v.id}`}
                  className="block px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors border-b border-[var(--border-subtle)] last:border-0"
                >
                  {v.place}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {geo.length === 0 && ungeo.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[var(--text-tertiary)] text-sm">Aucune visite pour l&apos;instant</p>
        </div>
      )}

      {geo.length > 0 && (
        <div
          ref={scrollerRef}
          className="absolute bottom-0 inset-x-0 z-[500] flex gap-2 overflow-x-auto px-3 pb-3 pt-8 snap-x snap-mandatory bg-gradient-to-t from-black/70 to-transparent"
        >
          {geo.map((v) => (
            <Link
              key={v.id}
              href={`/visites/${v.id}`}
              data-visit-id={v.id}
              ref={(el) => { if (el) cardRefs.current.set(v.id, el); }}
              onMouseEnter={() => focusVisit(v.id, true)}
              className={cn(
                "snap-center flex-shrink-0 w-40 rounded-lg overflow-hidden border bg-[var(--bg-elevated)] transition-colors",
                activeId === v.id ? "border-[var(--text-primary)]" : "border-[var(--border-subtle)]"
              )}
            >
              <div className="aspect-video bg-[var(--bg-surface)]">
                {v.thumbnailKey && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getThumbnailUrl(v.thumbnailKey)}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )}
              </div>
              <div className="px-2 py-1.5">
                <p className="text-[11px] text-[var(--text-primary)] truncate">{v.place}</p>
                <p className="text-[9px] text-[var(--text-tertiary)]">
                  {v.count} image{v.count !== 1 ? "s" : ""}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
