"use client";

import { useEffect, useRef } from "react";
import type { CloudImage } from "@/app/api/library/cloud/route";
import { calculerDisposition, type CloudMode } from "@/lib/moodboard/cloudLayout";
import { preparerAtlas, PAR_LIGNE } from "@/lib/moodboard/cloudAtlas";

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
attribute vec2 aUv;
attribute float aDim;
attribute float aIdx;
uniform float uCell;
uniform float uHover;
uniform float uTaille;
varying vec2 vUv;
varying float vDim;
void main() {
  vUv = aUv + uv * uCell;
  vDim = aDim;
  float survol = step(abs(aIdx - uHover), 0.5);
  float k = uTaille * (1.0 + survol * 0.4);
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  mv.xy += position.xy * k;
  gl_Position = projectionMatrix * mv;
}`;

const FS = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
varying float vDim;
void main() {
  vec4 c = texture2D(uTex, vUv);
  // Case d'atlas pas encore peinte : on ne dessine rien plutôt qu'un carré
  // noir. C'est ce qui rend le remplissage progressif acceptable à l'œil.
  if (c.a < 0.02) discard;
  gl_FragColor = vec4(mix(c.rgb, vec3(0.09), vDim * 0.72), 1.0);
}`;

export function ImageCloudScene({ images, mode, dejaPosees, onPick, onProgres }: Props) {
  const hote = useRef<HTMLDivElement>(null);
  const couche = useRef<HTMLDivElement>(null);   // étiquettes, en DOM impératif
  const bulle = useRef<HTMLDivElement>(null);    // titre au survol

  const onPickRef = useRef(onPick);
  const onProgresRef = useRef(onProgres);
  const modeRef = useRef(mode);
  const dejaRef = useRef(dejaPosees);
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
      // `three` n'est chargé QUE lorsque le nuage s'ouvre.
      const THREE = await import("three");
      if (abort.signal.aborted) return;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, 1, 1, 3000);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      el.appendChild(renderer.domElement);

      const n = images.length;
      const aPos = new Float32Array(n * 3);
      const posDe = new Float32Array(n * 3);
      const posVers = new Float32Array(n * 3);
      const aUv = new Float32Array(n * 2);
      const aDim = new Float32Array(n);
      const aIdx = new Float32Array(n);
      for (let i = 0; i < n; i++) aIdx[i] = i;

      let sale = true;   // faut-il redessiner ?
      let transition = 1;
      let etiquettes = calculerDisposition(images, modeRef.current).labels;
      let noeuds: HTMLSpanElement[] = [];

      const construireEtiquettes = () => {
        const c = couche.current;
        if (!c) return;
        c.replaceChildren();
        noeuds = etiquettes.map((l) => {
          const s = document.createElement("span");
          s.textContent = l.texte;
          s.className =
            "pointer-events-none absolute top-0 left-0 text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] whitespace-nowrap";
          c.appendChild(s);
          return s;
        });
      };

      const appliquer = (m: CloudMode, anime: boolean) => {
        const { points, labels } = calculerDisposition(images, m);
        for (let i = 0; i < n; i++) {
          posDe[i * 3] = anime ? aPos[i * 3] : points[i].x;
          posDe[i * 3 + 1] = anime ? aPos[i * 3 + 1] : points[i].y;
          posDe[i * 3 + 2] = anime ? aPos[i * 3 + 2] : points[i].z;
          posVers[i * 3] = points[i].x;
          posVers[i * 3 + 1] = points[i].y;
          posVers[i * 3 + 2] = points[i].z;
        }
        transition = anime ? 0 : 1;
        etiquettes = labels;
        construireEtiquettes();
        sale = true;
      };
      appliquer(modeRef.current, false);
      aPos.set(posVers);

      // ── Atlas : canvas VIDES tout de suite, remplis ensuite ─────────────
      // La version précédente attendait la DERNIÈRE vignette avant d'ajouter
      // quoi que ce soit à la scène : le nuage restait vide plusieurs secondes
      // derrière un compteur qui défilait seul. Ici la scène est complète et
      // navigable dès la première frame, et les images s'y inscrivent au fil
      // de l'eau.
      const atlas = preparerAtlas(images.map((i) => i.k));
      for (let i = 0; i < n; i++) {
        aUv[i * 2] = atlas.cases[i].u;
        aUv[i * 2 + 1] = atlas.cases[i].v;
      }
      const textures = atlas.canvases.map((cv) => {
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        // Sans mipmaps : il faudrait les régénérer à CHAQUE lot, ce qui
        // saccaderait tout le chargement.
        t.minFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        return t;
      });

      const meshes: InstanceType<typeof THREE.Mesh>[] = [];
      const geos: InstanceType<typeof THREE.InstancedBufferGeometry>[] = [];
      const hoverUniforms: { value: number }[] = [];
      const tailleUniforms: { value: number }[] = [];
      const indexParMesh: number[][] = [];

      for (let a = 0; a < atlas.canvases.length; a++) {
        const idx: number[] = [];
        for (let i = 0; i < n; i++) if (atlas.cases[i].atlas === a) idx.push(i);
        if (idx.length === 0) continue;

        const base = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.setIndex(base.index);
        geo.setAttribute("position", base.attributes.position);
        geo.setAttribute("uv", base.attributes.uv);
        geo.instanceCount = idx.length;

        const sub = (src: Float32Array, taille: number) => {
          const out = new Float32Array(idx.length * taille);
          idx.forEach((i, j) => { for (let k = 0; k < taille; k++) out[j * taille + k] = src[i * taille + k]; });
          return out;
        };
        geo.setAttribute("aPos", new THREE.InstancedBufferAttribute(sub(aPos, 3), 3));
        geo.setAttribute("aUv", new THREE.InstancedBufferAttribute(sub(aUv, 2), 2));
        geo.setAttribute("aDim", new THREE.InstancedBufferAttribute(sub(aDim, 1), 1));
        geo.setAttribute("aIdx", new THREE.InstancedBufferAttribute(sub(aIdx, 1), 1));

        const uHover = { value: -1 };
        const uTaille = { value: 7 };
        hoverUniforms.push(uHover);
        tailleUniforms.push(uTaille);
        const mat = new THREE.ShaderMaterial({
          vertexShader: VS, fragmentShader: FS,
          uniforms: { uTex: { value: textures[a] }, uCell: { value: 1 / PAR_LIGNE }, uHover, uTaille },
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;   // les quads sont replacés dans le shader
        scene.add(mesh);
        meshes.push(mesh);
        geos.push(geo);
        indexParMesh.push(idx);
      }

      void atlas.remplir((atlasModifies, charges, total) => {
        for (const a of atlasModifies) if (textures[a]) textures[a].needsUpdate = true;
        onProgresRef.current?.(charges, total);
        sale = true;
      }, abort.signal);

      // ── Caméra : inertie et amortissement ───────────────────────────────
      // La version précédente appliquait le déplacement du pointeur
      // directement aux angles : le mouvement s'arrêtait net au relâchement,
      // sensation raide. Ici le geste donne une VITESSE, qui retombe.
      let theta = 0.6, phi = 1.25;
      let vTheta = 0, vPhi = 0;
      let dist = 190, distCible = 190;
      const cible = new THREE.Vector3(0, 0, 0);
      const cibleVoulue = new THREE.Vector3(0, 0, 0);

      const majCamera = () => {
        camera.position.set(
          cible.x + dist * Math.sin(phi) * Math.cos(theta),
          cible.y + dist * Math.cos(phi),
          cible.z + dist * Math.sin(phi) * Math.sin(theta),
        );
        camera.lookAt(cible);
      };

      const redim = () => {
        const w = el.clientWidth, h = el.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        sale = true;
      };
      redim();
      const ro = new ResizeObserver(redim);
      ro.observe(el);

      // ── Désignation ─────────────────────────────────────────────────────
      // Projection manuelle plutôt que raycast : les quads sont déplacés dans
      // le shader, donc la géométrie connue de three ne correspond à rien.
      // N'est recalculée QUE sur mouvement du pointeur ou de la caméra — la
      // version précédente rebalayait les 370 images à chaque frame.
      const souris = { x: -1, y: -1, dedans: false };
      let survolIdx = -1;
      const v = new THREE.Vector3();

      const majSurvol = (i: number) => {
        if (i === survolIdx) return;
        survolIdx = i;
        for (const u of hoverUniforms) u.value = i;
        const b = bulle.current;
        if (b) {
          if (i >= 0) {
            const img = images[i];
            b.textContent = (img.t || "Sans titre") + (img.g.length ? ` · ${img.g.slice(0, 3).join(" · ")}` : "");
            b.style.opacity = "1";
          } else b.style.opacity = "0";
        }
        if (!glisse) el.style.cursor = i >= 0 ? "pointer" : "grab";
        sale = true;
      };

      const designer = () => {
        if (!souris.dedans) return;
        const w = el.clientWidth, h = el.clientHeight;
        const echelle = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
        const demiMonde = tailleUniforms[0]?.value ?? 7;
        let meilleur = -1, plusProche = Infinity;
        for (let i = 0; i < n; i++) {
          v.set(aPos[i * 3], aPos[i * 3 + 1], aPos[i * 3 + 2]).applyMatrix4(camera.matrixWorldInverse);
          if (v.z > -1) continue;
          const demi = (demiMonde / 2) * (echelle / -v.z);
          const sx = w / 2 + (v.x * echelle) / -v.z;
          const sy = h / 2 - (v.y * echelle) / -v.z;
          if (Math.abs(souris.x - sx) > demi || Math.abs(souris.y - sy) > demi) continue;
          // À recouvrement, la plus PROCHE de la caméra l'emporte.
          if (-v.z < plusProche) { plusProche = -v.z; meilleur = i; }
        }
        majSurvol(meilleur);
      };

      // ── Entrées ─────────────────────────────────────────────────────────
      let glisse: "orbite" | "pan" | null = null;
      let bougé = false, px = 0, py = 0;

      const onDown = (e: PointerEvent) => {
        // Clic droit ou Maj = déplacement latéral. Sans lui, impossible
        // d'examiner un amas excentré : la caméra tournait toujours autour du
        // même point.
        glisse = e.button === 2 || e.shiftKey ? "pan" : "orbite";
        bougé = false; px = e.clientX; py = e.clientY;
        vTheta = 0; vPhi = 0;
        el.setPointerCapture(e.pointerId);
        el.style.cursor = "grabbing";
      };
      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        souris.x = e.clientX - r.left; souris.y = e.clientY - r.top; souris.dedans = true;
        if (!glisse) { designer(); return; }
        const dx = e.clientX - px, dy = e.clientY - py;
        if (Math.abs(dx) + Math.abs(dy) > 4) bougé = true;
        if (glisse === "orbite") {
          vTheta = -dx * 0.0042;
          vPhi = -dy * 0.0042;
          theta += vTheta;
          phi = Math.min(Math.PI - 0.06, Math.max(0.06, phi + vPhi));
        } else {
          // Déplacement dans le plan de la caméra, proportionnel à la distance
          // pour que le geste garde la même amplitude apparente au zoom.
          const k = dist * 0.0022;
          const droite = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
          const haut = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
          cibleVoulue.addScaledVector(droite, -dx * k).addScaledVector(haut, dy * k);
        }
        px = e.clientX; py = e.clientY;
        sale = true;
      };
      const onUp = (e: PointerEvent) => {
        const etait = glisse;
        glisse = null;
        el.style.cursor = survolIdx >= 0 ? "pointer" : "grab";
        try { el.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ }
        // Un glissement N'EST PAS un clic : sans ce test, toute rotation
        // ajouterait une image à la planche.
        if (etait === "orbite" && !bougé && survolIdx >= 0) {
          onPickRef.current(images[survolIdx], e.clientX, e.clientY);
        }
      };
      const onLeave = () => { souris.dedans = false; majSurvol(-1); };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        // Proportionnel à l'amplitude réelle : le pas fixe précédent ignorait
        // la finesse d'un pavé tactile et rendait le zoom haché.
        const pas = Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0016));
        distCible = Math.min(500, Math.max(35, distCible * (1 + pas)));
        sale = true;
      };
      const onMenu = (e: Event) => e.preventDefault();
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointerleave", onLeave);
      el.addEventListener("wheel", onWheel, { passive: false });
      el.addEventListener("contextmenu", onMenu);

      // ── Étiquettes, en DOM impératif ────────────────────────────────────
      // La version précédente les passait par un `useState` appelé À CHAQUE
      // FRAME : soixante rendus React par seconde de tout le composant, avec
      // reconstruction de la liste. C'était la cause principale des saccades.
      const placerEtiquettes = () => {
        const w = el.clientWidth, h = el.clientHeight;
        const echelle = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
        for (let i = 0; i < etiquettes.length; i++) {
          const s = noeuds[i];
          if (!s) continue;
          const l = etiquettes[i];
          v.set(l.x, l.y, l.z).applyMatrix4(camera.matrixWorldInverse);
          if (v.z > -1) { s.style.opacity = "0"; continue; }
          s.style.opacity = "1";
          s.style.transform =
            `translate3d(${w / 2 + (v.x * echelle) / -v.z}px, ${h / 2 - (v.y * echelle) / -v.z}px, 0) translate(-50%, -50%)`;
        }
      };

      // ── Boucle ──────────────────────────────────────────────────────────
      // Ne redessine QUE si quelque chose bouge : une scène immobile ne coûte
      // rien, et laisse la machine à l'éditeur qui vit derrière le popup.
      let brut = 0;
      const boucle = () => {
        brut = requestAnimationFrame(boucle);

        // Inertie : la rotation se poursuit puis s'éteint.
        if (!glisse && (Math.abs(vTheta) > 1e-4 || Math.abs(vPhi) > 1e-4)) {
          theta += vTheta;
          phi = Math.min(Math.PI - 0.06, Math.max(0.06, phi + vPhi));
          vTheta *= 0.92; vPhi *= 0.92;
          sale = true;
        }
        if (Math.abs(distCible - dist) > 0.05) { dist += (distCible - dist) * 0.15; sale = true; }
        if (cible.distanceToSquared(cibleVoulue) > 0.01) { cible.lerp(cibleVoulue, 0.18); sale = true; }

        if (transition < 1) {
          transition = Math.min(1, transition + 0.02);
          const t = transition < 0.5 ? 4 * transition ** 3 : 1 - (-2 * transition + 2) ** 3 / 2;
          for (let i = 0; i < n * 3; i++) aPos[i] = posDe[i] + (posVers[i] - posDe[i]) * t;
          for (let mi = 0; mi < geos.length; mi++) {
            const at = geos[mi].attributes.aPos as InstanceType<typeof THREE.InstancedBufferAttribute>;
            const arr = at.array as Float32Array;
            const idx = indexParMesh[mi];
            for (let j = 0; j < idx.length; j++) {
              const i = idx[j];
              arr[j * 3] = aPos[i * 3]; arr[j * 3 + 1] = aPos[i * 3 + 1]; arr[j * 3 + 2] = aPos[i * 3 + 2];
            }
            at.needsUpdate = true;
          }
          sale = true;
        }

        if (!sale) return;
        sale = false;
        majCamera();
        placerEtiquettes();
        if (glisse || Math.abs(vTheta) > 1e-4) designer();
        renderer.render(scene, camera);
      };
      boucle();

      const surMode = (e: Event) => appliquer((e as CustomEvent<CloudMode>).detail, true);
      const surDeja = () => {
        for (let i = 0; i < n; i++) aDim[i] = dejaRef.current.has(images[i].id) ? 1 : 0;
        for (let mi = 0; mi < geos.length; mi++) {
          const at = geos[mi].attributes.aDim as InstanceType<typeof THREE.InstancedBufferAttribute>;
          const arr = at.array as Float32Array;
          const idx = indexParMesh[mi];
          for (let j = 0; j < idx.length; j++) arr[j] = aDim[idx[j]];
          at.needsUpdate = true;
        }
        sale = true;
      };
      const surTaille = (e: Event) => {
        for (const u of tailleUniforms) u.value = (e as CustomEvent<number>).detail;
        sale = true;
      };
      el.addEventListener("cloud-mode", surMode);
      el.addEventListener("cloud-deja", surDeja);
      el.addEventListener("cloud-taille", surTaille);
      surDeja();

      nettoyer = () => {
        cancelAnimationFrame(brut);
        ro.disconnect();
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointerleave", onLeave);
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("contextmenu", onMenu);
        el.removeEventListener("cloud-mode", surMode);
        el.removeEventListener("cloud-deja", surDeja);
        el.removeEventListener("cloud-taille", surTaille);
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

  // Mode et assombrissement passent par des événements DOM : remonter la scène
  // rechargerait les atlas pour un simple déplacement de points.
  useEffect(() => {
    hote.current?.dispatchEvent(new CustomEvent("cloud-mode", { detail: mode }));
  }, [mode]);
  useEffect(() => {
    hote.current?.dispatchEvent(new Event("cloud-deja"));
  }, [dejaPosees]);

  return (
    <div ref={hote} data-cloud className="absolute inset-0 select-none touch-none" style={{ cursor: "grab" }}>
      <div ref={couche} className="pointer-events-none absolute inset-0 overflow-hidden" />
      <div
        ref={bulle}
        className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-primary)] max-w-[70%] truncate transition-opacity duration-150"
        style={{ opacity: 0 }}
      />
    </div>
  );
}
