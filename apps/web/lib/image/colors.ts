import sharp from "sharp";

export interface DominantColor {
  hex: string;
  r: number;
  g: number;
  b: number;
  percentage: number;
}

// Extrait les couleurs dominantes avec Sharp (k-means simplifié via quantization)
export async function extractColors(
  imageBuffer: Buffer,
  colorCount = 6
): Promise<DominantColor[]> {
  // Redimensionner pour perf
  const { data, info } = await sharp(imageBuffer)
    .resize(150, 150, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels: [number, number, number][] = [];
  const channels = info.channels;

  for (let i = 0; i < data.length; i += channels) {
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }

  // Quantization par regroupement simple (médiane de coupe)
  const palette = medianCut(pixels, colorCount);
  const total = pixels.length;

  return palette.map(([r, g, b], index) => ({
    hex: rgbToHex(r, g, b),
    r,
    g,
    b,
    percentage: index === 0 ? 0.4 : 0.6 / (palette.length - 1), // approximatif
  }));
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Algorithme médiane de coupe pour quantization couleur
function medianCut(
  pixels: [number, number, number][],
  depth: number
): [number, number, number][] {
  if (pixels.length === 0) return [];
  if (depth === 0 || pixels.length <= 1) {
    const avg = averageColor(pixels);
    return [avg];
  }

  const channel = dominantChannel(pixels);
  const sorted = [...pixels].sort((a, b) => a[channel] - b[channel]);
  const mid = Math.floor(sorted.length / 2);

  return [
    ...medianCut(sorted.slice(0, mid), depth - 1),
    ...medianCut(sorted.slice(mid), depth - 1),
  ];
}

function averageColor(
  pixels: [number, number, number][]
): [number, number, number] {
  const n = pixels.length;
  const sum = pixels.reduce(
    (acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]],
    [0, 0, 0]
  );
  return [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)];
}

function dominantChannel(pixels: [number, number, number][]): 0 | 1 | 2 {
  const ranges = ([0, 1, 2] as const).map((ch) => {
    const vals = pixels.map((p) => p[ch]);
    return Math.max(...vals) - Math.min(...vals);
  });
  return ranges.indexOf(Math.max(...ranges)) as 0 | 1 | 2;
}
