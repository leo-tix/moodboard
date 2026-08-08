"use client";

import { useEffect, useRef, useState } from "react";
import type { CloudImage } from "@/app/api/library/cloud/route";
import { calculerDisposition, type CloudMode, type CloudLabel } from "@/lib/moodboard/cloudLayout";
import { construireAtlas, PAR_ATLAS, PAR_LIGNE } from "@/lib/moodboard/cloudAtlas";

interface Props {
  images: CloudImage[];
  mode: CloudMode;
  /** Images déjà posées sur la planche — assombries, mais toujours cliquables. */
  dejaPosees: Set<string>;
  /** Clic sur une vignette. Les coordonnées écran servent au vol de la carte. */
  onPick: (image: CloudImage, ecranX: number, ecranY: number) => void;
  onProgres?: (charges: number, total: number) => void;
}

const VS = `
attribute vec3 aPos;
attribute vec2 aSize;
attribute vec2 aUv;
attribute float aDim;
attribute float aIdx;
uniform float uCell;
uniform float uHover;
varying vec2 vUv;
varying float vDim;
void main() {
  vUv = aUv + uv * uCell;
  vDim = aDim;
  float survol = step(abs(aIdx - uHover), 0.5);
  // La vignette survolée grossit : c'est le seul retour possible quand des
  // centaines de quads partagent un même appel de dessin.
  float k = 1.0 + survol * 0.35;
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  mv.xy += position.xy * aSize * k;
  gl_Position = projectionMatrix * mv;
}`;

const FS = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
varying float vDim;
void main() {
  vec4 c = texture2D(uTex, vUv);
  // Case d'atlas jamais peinte (vignette manquante) : on ne dessine rien
  // plutôt qu'un carré noir.
  if (c.a < 0.02) discard;
  gl_FragColor = vec4(mix(c.rgb, vec3(0.09), vDim * 0.72), 1.0);
}`;

export function ImageCloudScene({ images, mode, dejaPosees, onPick, onProgres }: Props) {
  const hote = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<(CloudLabel & { sx: number; sy: number; vis: boolean })[]>([]);
  const [survol, setSurvol] = useState<CloudImage | null>(null);

  // Rappels dans des refs : la scène est montée UNE fois et vit dans un effet
  // sans dépendances. Les inclure la reconstruirait à chaque rendu du parent,
  // ce qui rechargerait les atlas.
  const onPickRef = useRef(onPick);
  const onProgresRef = useRef(onProgres);
  const modeRef = useRef(mode);
  const dejaRef = useRef(dejaPosees);

  // Assignées dans des EFFETS et non pendant le rendu : lire ou écrire une ref
  // au rendu est interdit par les règles des hooks (et casserait le mode
  // concurrent).
  useEffect(() => { onPickRef.current = onPick; }, [onPick]);
  useEffect(() => { onProgresRef.current = onProgres; }, [onProgres]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { dejaRef.current = dejaPosees; }, [dejaPosees]);

  useEffect(() => {
    if (!hote.current || images.length === 0) return;
    const el = hote.current;
    const abort = new AbortController();
    let nettoyer: (() => void) | null = null;

    (async () => {
      // `three` n'est chargé QUE lorsque le nuage s'ouvre : ~150 ko qui ne
      // pèsent jamais sur l'éditeur ni sur le reste du site.
      const THREE = await import("three");
      if (abort.signal.aborted) return;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, 1, 1, 2000);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      el.appendChild(renderer.domElement);

      const n = images.length;
      const aPos = new Float32Array(n * 3);
      const posDe = new Float32Array(n * 3);
      const posVers = new Float32Array(n * 3);
      const aSize = new Float32Array(n * 2);
      const aUv = new Float32Array(n * 2);
      const aDim = new Float32Array(n);
      const aIdx = new Float32Array(n);
      for (let i = 0; i < n; i++) aIdx[i] = i;

      const appliquer = (mode: CloudMode, anime: boolean) => {
        const { points, labels: lbl } = calculerDisposition(images, mode);
        for (let i = 0; i < n; i++) {
          posDe[i * 3] = anime ? aPos[i * 3] : points[i].x;
          posDe[i * 3 + 1] = anime ? aPos[i * 3 + 1] : points[i].y;
          posDe[i * 3 + 2] = anime ? aPos[i * 3 + 2] : points[i].z;
          posVers[i * 3] = points[i].x;
          posVers[i * 3 + 1] = points[i].y;
          posVers[i * 3 + 2] = points[i].z;
        }
        transition = anime ? 0 : 1;
        etiquettes = lbl;
      };
      let transition = 1;
      let etiquettes: CloudLabel[] = [];
      appliquer(modeRef.current, false);
      for (let i = 0; i < n * 3; i++) aPos[i] = posVers[i];

      // Atlas — la scène s'affiche pendant le remplissage.
      const { canvases, cases } = await construireAtlas(
        images.map((i) => i.k),
        (c, t) => onProgresRef.current?.(c, t),
        abort.signal,
      );
      if (abort.signal.aborted) { renderer.dispose(); return; }

      const TAILLE = 7;
      for (let i = 0; i < n; i++) {
        const r = cases[i].ratio || 1;
        // Les cases de l'atlas sont carrées (recadrage centré) : le quad l'est
        // aussi, sinon l'image serait étirée.
        aSize[i * 2] = TAILLE;
        aSize[i * 2 + 1] = TAILLE;
        aUv[i * 2] = cases[i].u;
        aUv[i * 2 + 1] = cases[i].v;
        void r;
      }

      const textures = canvases.map((cv) => {
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.generateMipmaps = true;
        t.needsUpdate = true;
        return t;
      });

      // Un maillage par atlas : chacun n'a qu'une texture, donc un seul appel
      // de dessin pour ses 256 images.
      const meshes: InstanceType<typeof THREE.Mesh>[] = [];
      const geos: InstanceType<typeof THREE.InstancedBufferGeometry>[] = [];
      const hoverUniforms: { value: number }[] = [];
      for (let a = 0; a < canvases.length; a++) {
        const idx: number[] = [];
        for (let i = 0; i < n; i++) if (cases[i].atlas === a) idx.push(i);
        if (idx.length === 0) continue;

        const base = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = base.index;
        geo.attributes.position = base.attributes.position;
        geo.attributes.uv = base.attributes.uv;
        geo.instanceCount = idx.length;

        const sub = (src: Float32Array, taille: number) => {
          const out = new Float32Array(idx.length * taille);
          idx.forEach((i, j) => { for (let k = 0; k < taille; k++) out[j * taille + k] = src[i * taille + k]; });
          return out;
        };
        geo.setAttribute("aPos", new THREE.InstancedBufferAttribute(sub(aPos, 3), 3));
        geo.setAttribute("aSize", new THREE.InstancedBufferAttribute(sub(aSize, 2), 2));
        geo.setAttribute("aUv", new THREE.InstancedBufferAttribute(sub(aUv, 2), 2));
        geo.setAttribute("aDim", new THREE.InstancedBufferAttribute(sub(aDim, 1), 1));
        geo.setAttribute("aIdx", new THREE.InstancedBufferAttribute(sub(aIdx, 1), 1));

        const uHover = { value: -1 };
        hoverUniforms.push(uHover);
        const mat = new THREE.ShaderMaterial({
          vertexShader: VS, fragmentShader: FS,
          uniforms: { uTex: { value: textures[a] }, uCell: { value: 1 / PAR_LIGNE }, uHover },
          transparent: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;   // les quads sont replacés dans le shader
        mesh.userData.idx = idx;
        scene.add(mesh);
        meshes.push(mesh);
        geos.push(geo);
      }

      // ── Caméra orbitale ────────────────────────────────────────────────
      let theta = 0.6, phi = 1.25, dist = 190;
      const majCamera = () => {
        camera.position.set(
          dist * Math.sin(phi) * Math.cos(theta),
          dist * Math.cos(phi),
          dist * Math.sin(phi) * Math.sin(theta),
        );
        camera.lookAt(0, 0, 0);
      };

      const redim = () => {
        const w = el.clientWidth, h = el.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      redim();
      const ro = new ResizeObserver(redim);
      ro.observe(el);

      let glisse = false, bougé = false, px = 0, py = 0;
      const onDown = (e: PointerEvent) => { glisse = true; bougé = false; px = e.clientX; py = e.clientY; el.setPointerCapture(e.pointerId); };
      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        souris.x = e.clientX - r.left; souris.y = e.clientY - r.top;
        if (!glisse) return;
        const dx = e.clientX - px, dy = e.clientY - py;
        if (Math.abs(dx) + Math.abs(dy) > 4) bougé = true;
        theta -= dx * 0.005;
        phi = Math.min(Math.PI - 0.05, Math.max(0.05, phi - dy * 0.005));
        px = e.clientX; py = e.clientY;
      };
      const onUp = (e: PointerEvent) => {
        glisse = false;
        try { el.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ }
        // Un glissement N'EST PAS un clic : sans ce test, toute rotation
        // ajouterait une image à la planche.
        if (!bougé && survolIdx >= 0) {
          onPickRef.current(images[survolIdx], e.clientX, e.clientY);
        }
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        dist = Math.min(420, Math.max(45, dist * (1 + Math.sign(e.deltaY) * 0.12)));
      };
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("wheel", onWheel, { passive: false });

      // ── Désignation ────────────────────────────────────────────────────
      // Projection manuelle plutôt que raycast : les quads sont déplacés dans
      // le shader, donc la géométrie que three connaît ne correspond à rien.
      const souris = { x: -1, y: -1 };
      let survolIdx = -1;
      const v = new THREE.Vector3();
      const designer = () => {
        const w = el.clientWidth, h = el.clientHeight;
        let meilleur = -1, meilleureDist = Infinity;
        const echelle = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
        for (let i = 0; i < n; i++) {
          v.set(aPos[i * 3], aPos[i * 3 + 1], aPos[i * 3 + 2]).applyMatrix4(camera.matrixWorldInverse);
          if (v.z > -1) continue;                       // derrière la caméra
          const demi = (aSize[i * 2] / 2) * (echelle / -v.z);
          const sx = w / 2 + (v.x * echelle) / -v.z;
          const sy = h / 2 - (v.y * echelle) / -v.z;
          if (Math.abs(souris.x - sx) > demi || Math.abs(souris.y - sy) > demi) continue;
          // À recouvrement, la plus PROCHE de la caméra l'emporte : c'est
          // celle que l'on voit.
          if (-v.z < meilleureDist) { meilleureDist = -v.z; meilleur = i; }
        }
        if (meilleur !== survolIdx) {
          survolIdx = meilleur;
          for (const u of hoverUniforms) u.value = meilleur;
          setSurvol(meilleur >= 0 ? images[meilleur] : null);
          el.style.cursor = meilleur >= 0 ? "pointer" : "grab";
        }
      };

      // ── Boucle ─────────────────────────────────────────────────────────
      let brut = 0;
      const boucle = () => {
        brut = requestAnimationFrame(boucle);

        if (transition < 1) {
          transition = Math.min(1, transition + 0.022);
          const t = transition < 0.5 ? 4 * transition ** 3 : 1 - (-2 * transition + 2) ** 3 / 2;
          for (let i = 0; i < n * 3; i++) aPos[i] = posDe[i] + (posVers[i] - posDe[i]) * t;
          meshes.forEach((m, mi) => {
            const idx = m.userData.idx as number[];
            const at = geos[mi].attributes.aPos as InstanceType<typeof THREE.InstancedBufferAttribute>;
            idx.forEach((i, j) => {
              (at.array as Float32Array)[j * 3] = aPos[i * 3];
              (at.array as Float32Array)[j * 3 + 1] = aPos[i * 3 + 1];
              (at.array as Float32Array)[j * 3 + 2] = aPos[i * 3 + 2];
            });
            at.needsUpdate = true;
          });
        }

        majCamera();
        designer();

        // Étiquettes : projetées en HTML plutôt que dessinées en 3D — le texte
        // reste net à toute distance et hérite des styles du site.
        const w = el.clientWidth, h = el.clientHeight;
        const echelle = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
        setLabels(
          etiquettes.map((l) => {
            v.set(l.x, l.y, l.z).applyMatrix4(camera.matrixWorldInverse);
            return {
              ...l,
              sx: w / 2 + (v.x * echelle) / -v.z,
              sy: h / 2 - (v.y * echelle) / -v.z,
              vis: v.z < -1,
            };
          }),
        );

        renderer.render(scene, camera);
      };
      boucle();

      // Changement de mode et assombrissement, sans reconstruire la scène.
      const surMode = (e: Event) => appliquer((e as CustomEvent<CloudMode>).detail, true);
      const surDeja = () => {
        for (let i = 0; i < n; i++) aDim[i] = dejaRef.current.has(images[i].id) ? 1 : 0;
        meshes.forEach((m, mi) => {
          const idx = m.userData.idx as number[];
          const at = geos[mi].attributes.aDim as InstanceType<typeof THREE.InstancedBufferAttribute>;
          idx.forEach((i, j) => { (at.array as Float32Array)[j] = aDim[i]; });
          at.needsUpdate = true;
        });
      };
      el.addEventListener("cloud-mode", surMode);
      el.addEventListener("cloud-deja", surDeja);
      surDeja();

      nettoyer = () => {
        cancelAnimationFrame(brut);
        ro.disconnect();
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("cloud-mode", surMode);
        el.removeEventListener("cloud-deja", surDeja);
        // Libération EXPLICITE : la mémoire vidéo n'est pas ramassée par le
        // navigateur. Deux atlas de 2048² rouverts dix fois, c'est 160 Mo
        // perdus jusqu'au rechargement de l'onglet.
        textures.forEach((t) => t.dispose());
        geos.forEach((g) => g.dispose());
        meshes.forEach((m) => (m.material as InstanceType<typeof THREE.Material>).dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => { abort.abort(); nettoyer?.(); };
  }, [images]);

  // Le changement de mode passe par un événement DOM : remonter la scène
  // rechargerait les atlas pour un simple déplacement de points.
  useEffect(() => {
    hote.current?.dispatchEvent(new CustomEvent("cloud-mode", { detail: mode }));
  }, [mode]);
  useEffect(() => {
    hote.current?.dispatchEvent(new Event("cloud-deja"));
  }, [dejaPosees]);

  return (
    <div ref={hote} className="absolute inset-0 select-none touch-none" style={{ cursor: "grab" }}>
      {labels.map((l, i) =>
        l.vis ? (
          <span
            key={i}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]"
            style={{ left: l.sx, top: l.sy }}
          >
            {l.texte}
          </span>
        ) : null,
      )}
      {survol && (
        <span className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-primary)] max-w-[70%] truncate">
          {survol.t || "Sans titre"}
          {survol.g.length > 0 && (
            <span className="text-[var(--text-tertiary)]"> · {survol.g.slice(0, 3).join(" · ")}</span>
          )}
        </span>
      )}
    </div>
  );
}

export { PAR_ATLAS };
