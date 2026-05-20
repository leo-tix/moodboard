import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Fusionne classes Tailwind sans conflits
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Formate les octets en unité lisible
export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

// Génère un slug depuis un texte
export function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

// Tronque un texte avec ellipsis
export function truncate(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
