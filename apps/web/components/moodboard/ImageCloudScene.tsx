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

// Deux positions et un curseur : le changement de mode s'interpole
// ENTIÈREMENT sur la carte graphique. La version précédente réécrivait le
// tampon de positions à chaque frame côté processeur — un transfert complet
// vers le GPU soixante fois par seconde pour une animation de deux secondes.
// (Technique reprise de PixPlot, qui anime un uniforme `transitionPercent`.)
const VS = `
attribute vec3 aPosA;
attribute vec3 aPosB;
attribute vec2 aUv;
attribute float aDim;
attribute float aIdx;
uniform float uCell;
uniform float uHover;
uniform float uTaille;
uniform float uT;
varying vec2 vUv;
varying float vDim;
varying float vFond;
void main() {
  vUv = aUv + uv * uCell;
  vDim = aDim;
  float survol = step(abs(aIdx - uHover), 0.5);
  float k = uTaille * (1.0 + survol * 0.4);
  vec3 pos = mix(aPosA, aPosB, uT);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  mv.xy += position.xy * k;
  // Fondu de profondeur (Codrops, Infinite Canvas) : les images lointaines
  // se fondent dans le fond. Donne la profondeur que la seule perspective ne
  // suffit pas à faire lire dans un nuage dense, et adoucit les apparitions.
  float d = -mv.z;
  vFond = clamp((d - 170.0) / 160.0, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const FS = `
precision mediump float;
uniform sampler2D uTex;
uniform vec3 uFond;
varying vec2 vUv;
varying float vDim;
varying float vFond;
void main() {
  vec4 c = texture2D(uTex, vUv);
  // Case d'atlas pas encore peinte : on ne dessine rien plutôt qu'un carré
  // noir. C'est ce qui rend le remplissage progressif acceptable à l'œil.
  if (c.a < 0.02) discard;
  vec3 rgb = mix(c.rgb, vec3(0.09), vDim * 0.72);
  // Fondu vers le FOND, pas vers la transparence : un quad translucide
  // exigerait un tri par profondeur et casserait les occlusions dans un nuage
  // aussi dense.
  gl_FragColor = vec4(mix(rgb, uFond, vFond), 1.0);
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
      // Groupe pivotant : la caméra de l'article ne tourne pas, elle se
      // déplace. Pour rester capable d'examiner un nuage sous un autre angle,
      // c'est le CONTENU qu'on oriente, pas l'observateur.
      const monde = new THREE.Group();
      scene.add(monde);
      const camera = new THREE.PerspectiveCamera(50, 1, 1, 3000);

      // Réglages repris de Codrops (Infinite Canvas) : l'antialiasing est
      // sacrifié à la stabilité d'image, et le ratio de pixels plafonné à 1,5
      // — à 2 on dessinait 1,8 fois plus de pixels pour un gain invisible sur
      // des vignettes de quelques dizaines de pixels.
      const tactile = matchMedia("(pointer: coarse)").matches;
      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, tactile ? 1.25 : 1.5));
      el.appendChild(renderer.domElement);

      // Couleur de fond réelle de la page, pour que le fondu de profondeur
      // s'y confonde au lieu de virer au gris.
      const fondCss = getComputedStyle(document.body).backgroundColor;
      const uFond = { value: new THREE.Color(fondCss || "#0a0a0a") };

      const n = images.length;
      const aPosA = new Float32Array(n * 3);   // départ de la transition
      const aPosB = new Float32Array(n * 3);   // arrivée
      const aUv = new Float32Array(n * 2);
      const aDim = new Float32Array(n);
      const aIdx = new Float32Array(n);
      for (let i = 0; i < n; i++) aIdx[i] = i;

      let sale = true;   // faut-il redessiner ?
      const uT = { value: 1 };   // curseur de transition, lu par le shader
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

      // UNE seule écriture de tampon par changement de mode, au lieu d'une par
      // frame : le point de départ est figé (position courante, interpolée) et
      // le shader fait le reste.
      const appliquer = (m: CloudMode, anime: boolean) => {
        const { points, labels } = calculerDisposition(images, m);
        const t = uT.value;
        for (let i = 0; i < n; i++) {
          for (let k = 0; k < 3; k++) {
            const j = i * 3 + k;
            const courant = anime ? aPosA[j] + (aPosB[j] - aPosA[j]) * t : 0;
            const dest = k === 0 ? points[i].x : k === 1 ? points[i].y : points[i].z;
            aPosA[j] = anime ? courant : dest;
            aPosB[j] = dest;
          }
        }
        uT.value = anime ? 0 : 1;
        transition = anime ? 0 : 1;
        etiquettes = labels;
        construireEtiquettes();
        pousserPositions();
        sale = true;
      };

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
        const attrA = new THREE.InstancedBufferAttribute(sub(aPosA, 3), 3);
        const attrB = new THREE.InstancedBufferAttribute(sub(aPosB, 3), 3);
        // Ces deux tampons ne changent qu'au changement de mode ; l'animation
        // se fait par uniforme. Pas de `DynamicDrawUsage` ici, contrairement à
        // l'ancienne version qui les réécrivait en boucle.
        geo.setAttribute("aPosA", attrA);
        geo.setAttribute("aPosB", attrB);
        geo.setAttribute("aUv", new THREE.InstancedBufferAttribute(sub(aUv, 2), 2));
        geo.setAttribute("aDim", new THREE.InstancedBufferAttribute(sub(aDim, 1), 1));
        geo.setAttribute("aIdx", new THREE.InstancedBufferAttribute(sub(aIdx, 1), 1));

        const uHover = { value: -1 };
        const uTaille = { value: 7 };
        hoverUniforms.push(uHover);
        tailleUniforms.push(uTaille);
        const mat = new THREE.ShaderMaterial({
          vertexShader: VS, fragmentShader: FS,
          uniforms: { uTex: { value: textures[a] }, uCell: { value: 1 / PAR_LIGNE }, uHover, uTaille, uT, uFond },
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;   // les quads sont replacés dans le shader
        monde.add(mesh);
        meshes.push(mesh);
        geos.push(geo);
        indexParMesh.push(idx);
      }

      const pousserPositions = () => {
        for (let mi = 0; mi < geos.length; mi++) {
          const idx = indexParMesh[mi];
          const a = geos[mi].attributes.aPosA as InstanceType<typeof THREE.InstancedBufferAttribute>;
          const b = geos[mi].attributes.aPosB as InstanceType<typeof THREE.InstancedBufferAttribute>;
          const ta = a.array as Float32Array, tb = b.array as Float32Array;
          for (let j = 0; j < idx.length; j++) {
            const i = idx[j];
            ta[j * 3] = aPosA[i * 3]; ta[j * 3 + 1] = aPosA[i * 3 + 1]; ta[j * 3 + 2] = aPosA[i * 3 + 2];
            tb[j * 3] = aPosB[i * 3]; tb[j * 3 + 1] = aPosB[i * 3 + 1]; tb[j * 3 + 2] = aPosB[i * 3 + 2];
          }
          a.needsUpdate = true; b.needsUpdate = true;
        }
      };

      // Première disposition, une fois les maillages construits.
      appliquer(modeRef.current, false);

      void atlas.remplir((atlasModifies, charges, total) => {
        for (const a of atlasModifies) if (textures[a]) textures[a].needsUpdate = true;
        onProgresRef.current?.(charges, total);
        sale = true;
      }, abort.signal);

      // ── Caméra : vélocité intégrée (modèle Codrops, Infinite Canvas) ────
      //
      // Le geste n'agit pas sur la position mais sur une VITESSE CIBLE, vers
      // laquelle la vitesse réelle est interpolée à chaque frame, et qui
      // retombe d'elle-même. Toute l'intégration se fait en UN point, ce qui
      // découple la saisie de la physique : le mouvement continue après le
      // relâchement au lieu de s'arrêter net.
      //
      // Constantes de l'article, conservées telles quelles.
      const VELOCITY_LERP = 0.18;
      const VELOCITY_DECAY = 0.92;
      const GLISSE_VERS_VITESSE = 0.025;
      const MOLETTE_VERS_Z = 0.006;
      const MOLETTE_DECAY = 0.8;
      const Z_MIN = 45, Z_MAX = 520;

      const basePos = { x: 0, y: 0, z: 190 };
      const vitesse = { x: 0, y: 0, z: 0 };
      const vitesseCible = { x: 0, y: 0, z: 0 };
      let molette = 0;
      // Rotation : l'article n'en a pas — sa caméra regarde toujours dans la
      // même direction. Ici le nuage a une structure en trois dimensions
      // qu'il faut pouvoir examiner, donc on fait pivoter le CONTENU.
      let rotX = 0, rotY = 0, vRotX = 0, vRotY = 0;

      const majCamera = () => {
        camera.position.set(basePos.x, basePos.y, basePos.z);
        camera.lookAt(basePos.x, basePos.y, basePos.z - 1);
        monde.rotation.set(rotX, rotY, 0);
        monde.updateMatrixWorld();
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
        const t = uT.value;
        let meilleur = -1, plusProche = Infinity;
        for (let i = 0; i < n; i++) {
          // Même calcul que le shader : position interpolée, puis matrice du
          // groupe (rotation) avant celle de la caméra. Omettre l'une des deux
          // ferait cliquer à côté dès qu'on tourne ou change de mode.
          v.set(
            aPosA[i * 3] + (aPosB[i * 3] - aPosA[i * 3]) * t,
            aPosA[i * 3 + 1] + (aPosB[i * 3 + 1] - aPosA[i * 3 + 1]) * t,
            aPosA[i * 3 + 2] + (aPosB[i * 3 + 2] - aPosA[i * 3 + 2]) * t,
          ).applyMatrix4(monde.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
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
      let glisse: "rotation" | "pan" | null = null;
      let bougé = false, px = 0, py = 0;

      const onDown = (e: PointerEvent) => {
        // Glisser DÉPLACE, comme dans l'article : on se promène dans l'espace
        // plutôt que de tourner autour d'un point. Maj ou clic droit fait
        // pivoter le nuage, pour en voir la structure sous un autre angle.
        glisse = e.button === 2 || e.shiftKey ? "rotation" : "pan";
        bougé = false; px = e.clientX; py = e.clientY;
        el.setPointerCapture(e.pointerId);
        el.style.cursor = "grabbing";
      };
      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        souris.x = e.clientX - r.left; souris.y = e.clientY - r.top; souris.dedans = true;
        if (!glisse) { designer(); return; }
        const dx = e.clientX - px, dy = e.clientY - py;
        if (Math.abs(dx) + Math.abs(dy) > 4) bougé = true;
        if (glisse === "rotation") {
          vRotY = -dx * 0.0045;
          vRotX = -dy * 0.0045;
          rotY += vRotY;
          rotX = Math.max(-1.4, Math.min(1.4, rotX + vRotX));
        } else {
          // Le geste alimente la vitesse CIBLE, il ne déplace pas la caméra
          // lui-même — c'est ce qui donne l'élan après le relâchement.
          // Mise à l'échelle par la distance : à fort zoom, un même geste doit
          // parcourir moins de monde, sinon on traverse tout d'un coup.
          const k = GLISSE_VERS_VITESSE * (basePos.z / 190);
          vitesseCible.x -= dx * k;
          vitesseCible.y += dy * k;
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
        if (etait === "pan" && !bougé && survolIdx >= 0) {
          onPickRef.current(images[survolIdx], e.clientX, e.clientY);
        }
      };
      const onLeave = () => { souris.dedans = false; majSurvol(-1); };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        // Accumulation puis relâchement progressif (Codrops) : le zoom garde
        // son élan, et suit l'amplitude réelle du geste au lieu d'un pas fixe
        // qui ignorait la finesse d'un pavé tactile.
        molette += e.deltaY * MOLETTE_VERS_Z;
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

        // Molette : accumulée puis relâchée progressivement, ce qui donne au
        // zoom son élan au lieu d'un à-coup par cran.
        if (Math.abs(molette) > 1e-4) {
          vitesseCible.z += molette;
          molette *= MOLETTE_DECAY;
          sale = true;
        }

        // Intégration en UN point : vitesse → position → amortissement.
        const bouge =
          Math.abs(vitesse.x) > 1e-3 || Math.abs(vitesse.y) > 1e-3 || Math.abs(vitesse.z) > 1e-3 ||
          Math.abs(vitesseCible.x) > 1e-3 || Math.abs(vitesseCible.y) > 1e-3 || Math.abs(vitesseCible.z) > 1e-3;
        if (bouge) {
          vitesse.x += (vitesseCible.x - vitesse.x) * VELOCITY_LERP;
          vitesse.y += (vitesseCible.y - vitesse.y) * VELOCITY_LERP;
          vitesse.z += (vitesseCible.z - vitesse.z) * VELOCITY_LERP;
          basePos.x += vitesse.x;
          basePos.y += vitesse.y;
          basePos.z = Math.min(Z_MAX, Math.max(Z_MIN, basePos.z + vitesse.z));
          vitesseCible.x *= VELOCITY_DECAY;
          vitesseCible.y *= VELOCITY_DECAY;
          vitesseCible.z *= VELOCITY_DECAY;
          sale = true;
        }

        // Même modèle pour la rotation du contenu.
        if (Math.abs(vRotX) > 1e-5 || Math.abs(vRotY) > 1e-5) {
          rotX = Math.max(-1.4, Math.min(1.4, rotX + vRotX));
          rotY += vRotY;
          vRotX *= VELOCITY_DECAY;
          vRotY *= VELOCITY_DECAY;
          sale = true;
        }

        // Transition de mode : un seul uniforme avance, aucun tampon n'est
        // retouché. Deux secondes, comme PixPlot.
        if (transition < 1) {
          transition = Math.min(1, transition + 1 / 120);
          uT.value = transition < 0.5 ? 4 * transition ** 3 : 1 - (-2 * transition + 2) ** 3 / 2;
          sale = true;
        }

        if (!sale) return;
        sale = false;
        majCamera();
        placerEtiquettes();
        if (glisse || bouge) designer();
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
