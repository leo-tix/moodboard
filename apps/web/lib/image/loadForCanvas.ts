// Charge une image R2 utilisable dans un <canvas> sans "tainter" celui-ci
// (export PNG impossible si taint). Même stratégie que l'export des planches
// (lib/moodboard/export.ts) : R2 direct avec CORS d'abord, repli sur le proxy
// même-origine sinon (dev local, CORS non configuré…). Transparent à
// l'environnement.
export function loadImageForCanvas(storageKey: string): Promise<HTMLImageElement> {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";
  const directUrl = `${base}/${storageKey}`;
  const proxyUrl = `/api/proxy-image?key=${encodeURIComponent(storageKey)}`;

  return new Promise((resolve, reject) => {
    const direct = new Image();
    direct.crossOrigin = "anonymous";
    direct.onload = () => resolve(direct);
    direct.onerror = () => {
      const proxy = new Image();
      proxy.onload = () => resolve(proxy);
      proxy.onerror = () => reject(new Error(`Failed to load image: ${storageKey}`));
      proxy.src = proxyUrl;
    };
    direct.src = directUrl;
  });
}
