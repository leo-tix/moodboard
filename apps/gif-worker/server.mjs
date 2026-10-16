// Service autonome de conversion vidéo → GIF (trim in/out + ffmpeg), pensé
// pour tourner sur un petit VPS partagé avec d'autres projets (2 vCPU/3.7 Go
// ici) : une seule conversion ffmpeg à la fois par défaut, durée et poids
// d'entrée plafonnés, fichiers temporaires toujours nettoyés. Appelé
// serveur-à-serveur depuis apps/web (jamais exposé au navigateur) via un
// jeton partagé — voir .env.example.
import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const PORT = process.env.PORT || 8091;
const TOKEN = process.env.GIF_WORKER_TOKEN;
// Origine autorisée à appeler ce service directement depuis le navigateur
// (le navigateur envoie la vidéo ICI, pas via une fonction Vercel — une
// vidéo dépasse facilement la limite de payload des fonctions serverless
// Vercel, ~4.5 Mo). Le ticket (voir plus bas) limite ce qu'un appel
// cross-origin peut faire : un jeton signé, à courte durée de vie, émis
// par apps/web après vérification de session utilisateur.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || "https://moodboard.leotix.fr,http://localhost:3000")
  .split(",").map((s) => s.trim()).filter(Boolean);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 150 * 1024 * 1024); // 150 Mo
const MAX_DURATION_S = Number(process.env.MAX_DURATION_S || 15);
const MAX_WIDTH = Number(process.env.MAX_WIDTH || 480);
const DEFAULT_FPS = Number(process.env.DEFAULT_FPS || 12);
const MAX_FPS = Number(process.env.MAX_FPS || 20);
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 1);
const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 60_000);

if (!TOKEN) {
  console.error("GIF_WORKER_TOKEN manquant — arrêt (voir .env.example).");
  process.exit(1);
}

// ── File d'attente simple : au plus MAX_CONCURRENCY conversions ffmpeg en
// parallèle, pour ne pas affamer les autres projets du VPS. ──────────────
let active = 0;
const queue = [];
function runExclusive(task) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (active >= MAX_CONCURRENCY) { queue.push(attempt); return; }
      active++;
      task().then(resolve, reject).finally(() => {
        active--;
        const next = queue.shift();
        if (next) next();
      });
    };
    attempt();
  });
}

function timingSafeTokenEqual(a, b) {
  const bufA = Buffer.from(a || "");
  const bufB = Buffer.from(b || "");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Deux formes de jeton acceptées :
//  · le jeton statique (GIF_WORKER_TOKEN tel quel) — usage server-to-server
//    (tests, ou un futur appel direct depuis apps/web).
//  · un TICKET signé « <expirationUnix>.<hmacHex> », où hmacHex =
//    HMAC-SHA256(GIF_WORKER_TOKEN, expirationUnix) — émis par apps/web
//    après vérification de session, à courte durée de vie. C'est la forme
//    utilisée par le navigateur : le secret statique n'est JAMAIS envoyé
//    au client, seul ce ticket éphémère l'est.
function verifyTicket(ticket) {
  const [expStr, mac] = String(ticket || "").split(".");
  const exp = Number(expStr);
  if (!exp || !mac || !Number.isFinite(exp)) return false;
  if (Date.now() / 1000 > exp) return false;
  const expected = crypto.createHmac("sha256", TOKEN).update(expStr).digest("hex");
  return timingSafeTokenEqual(mac, expected);
}

function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (timingSafeTokenEqual(provided, TOKEN) || verifyTicket(provided)) return next();
  return res.status(401).json({ error: "unauthorized" });
}

function runFfmpeg(args, { timeoutMs = FFMPEG_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
    const killer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.on("error", (err) => { clearTimeout(killer); reject(err); });
    proc.on("close", (code) => {
      clearTimeout(killer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg a échoué (code ${code}): ${stderr.slice(-2000)}`));
    });
  });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, req.workDir),
    filename: (_req, _file, cb) => cb(null, "input"),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

const app = express();

// CORS restreint à l'origine de l'app — le navigateur appelle ce service
// directement (voir ALLOWED_ORIGIN plus haut).
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Max-Age", "600");
    return res.status(204).end();
  }
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post(
  "/convert",
  requireAuth,
  async (req, res, next) => {
    try {
      req.workDir = await mkdtemp(path.join(tmpdir(), "gif-"));
      next();
    } catch (err) { next(err); }
  },
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: "upload", message: err.message });
      next();
    });
  },
  async (req, res) => {
    const cleanup = () => rm(req.workDir, { recursive: true, force: true }).catch(() => {});
    try {
      if (!req.file) return res.status(400).json({ error: "no_file" });

      const start = Number(req.body.start ?? 0);
      const end = Number(req.body.end ?? NaN);
      const fps = Math.min(MAX_FPS, Math.max(1, Number(req.body.fps) || DEFAULT_FPS));
      const width = Math.min(MAX_WIDTH, Math.max(64, Number(req.body.width) || MAX_WIDTH));

      if (!Number.isFinite(start) || start < 0) return res.status(400).json({ error: "bad_start" });
      if (!Number.isFinite(end) || end <= start) return res.status(400).json({ error: "bad_end" });
      const duration = end - start;
      if (duration > MAX_DURATION_S) {
        return res.status(400).json({ error: "too_long", maxSeconds: MAX_DURATION_S });
      }

      const input = req.file.path;
      const palette = path.join(req.workDir, "palette.png");
      const output = path.join(req.workDir, "output.gif");
      const vf = `fps=${fps},scale=${width}:-1:flags=lanczos`;

      await runExclusive(async () => {
        // Deux passes (palette dédiée) : bien meilleure qualité/poids qu'une
        // conversion directe — c'est la méthode standard ffmpeg pour les GIF.
        await runFfmpeg([
          "-y", "-ss", String(start), "-to", String(end), "-i", input,
          "-vf", `${vf},palettegen=stats_mode=diff`,
          palette,
        ]);
        await runFfmpeg([
          "-y", "-ss", String(start), "-to", String(end), "-i", input, "-i", palette,
          "-lavfi", `${vf}[x];[x][1:v]paletteuse=dither=bayer`,
          output,
        ]);
      });

      const { size } = await stat(output);
      res.set("Content-Type", "image/gif");
      res.set("Content-Length", String(size));
      const { createReadStream } = await import("node:fs");
      const stream = createReadStream(output);
      stream.pipe(res);
      stream.on("close", cleanup);
      stream.on("error", cleanup);
    } catch (err) {
      console.error("[convert]", err);
      res.status(500).json({ error: "conversion_failed", message: String(err.message || err) });
      cleanup();
    }
  },
);

// Erreurs non interceptées plus haut (ex. mkdtemp).
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`gif-worker à l'écoute sur :${PORT} (concurrence max ${MAX_CONCURRENCY}, durée max ${MAX_DURATION_S}s)`);
});
