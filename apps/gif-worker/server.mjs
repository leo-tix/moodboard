// Service autonome de conversion vidéo → GIF (trim in/out + ffmpeg), pensé
// pour tourner sur un petit VPS partagé avec d'autres projets (2 vCPU/3.7 Go
// ici) : une seule conversion ffmpeg à la fois par défaut, durée et poids
// d'entrée plafonnés, fichiers temporaires toujours nettoyés. Appelé
// serveur-à-serveur depuis apps/web (jamais exposé au navigateur) via un
// jeton partagé — voir .env.example.
import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";

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
// 1,5 Go — généreux volontairement : la vidéo brute n'est JAMAIS conservée
// (fichier temporaire supprimé après conversion, voir cleanup()), seul le
// GIF recadré repart. Le "-ss" avant "-i" (seek d'ENTRÉE, pas de décodage)
// fait que le poids du fichier source n'allonge pas le temps de conversion
// du passage recadré — seul le temps de transfert en dépend (retour
// utilisateur 2026-10-16).
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 1.5 * 1024 * 1024 * 1024);
const MAX_DURATION_S = Number(process.env.MAX_DURATION_S || 15);
const MAX_WIDTH = Number(process.env.MAX_WIDTH || 480);
const DEFAULT_FPS = Number(process.env.DEFAULT_FPS || 12);
const MAX_FPS = Number(process.env.MAX_FPS || 20);
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 1);
const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 90_000);

// ── Import vidéo par lien (TikTok / Instagram / générique → GIF) ─────────
// Téléchargement complet via yt-dlp, en sous-processus — même esprit que
// /convert : poids plafonné, nettoyage systématique, concurrence à part
// (réseau/disque, pas CPU ffmpeg : sa propre file, voir runYtDlpExclusive).
const YTDLP_BIN = process.env.YTDLP_BIN || "yt-dlp";
const YTDLP_MAX_CONCURRENCY = Number(process.env.YTDLP_MAX_CONCURRENCY || 1);
// 500 Mo / 10 min — mêmes plafonds que les métadonnées vérifiées côté
// apps/web (/api/video-link/ticket) AVANT l'émission du ticket ; reposés
// ici en dur comme GARDE-FOU RÉEL (le ticket n'est pas lié à une URL
// précise, comme pour /convert — c'est CE service qui fait foi).
const MAX_FETCH_BYTES = Number(process.env.MAX_FETCH_BYTES || 500 * 1024 * 1024);
const MAX_FETCH_DURATION_S = Number(process.env.MAX_FETCH_DURATION_S || 600);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 180_000);
// 30s : testé en local, l'extraction -J prend 2-5s en régime normal, mais le
// tout premier appel peut dépasser largement (cache d'extracteur à froid) —
// marge pour ne pas rejeter une vidéo légitime sur un simple cold start.
const META_TIMEOUT_MS = Number(process.env.META_TIMEOUT_MS || 30_000);
// Section YouTube (#7) : borne DUPLIQUÉE ici par sécurité (même esprit que
// MAX_FETCH_BYTES/MAX_FETCH_DURATION_S pour /fetch-url) — le ticket émis
// par apps/web n'est pas lié à une plage précise, ce service doit
// revalider par lui-même. Volontairement bien plus bas que
// MAX_FETCH_DURATION_S : on ne télécharge jamais plus qu'un passage.
const MAX_FETCH_SECTION_DURATION_S = Number(process.env.MAX_FETCH_SECTION_DURATION_S || 120);

if (!TOKEN) {
  console.error("GIF_WORKER_TOKEN manquant — arrêt (voir .env.example).");
  process.exit(1);
}

// ── File d'attente simple : au plus `max` tâches en parallèle, pour ne pas
// affamer les autres projets du VPS. Une instance par ressource (ffmpeg,
// yt-dlp) : les deux n'ont pas le même profil (CPU vs réseau/disque), pas de
// raison de les serialiser ensemble. ──────────────────────────────────────
function createLimiter(max) {
  let active = 0;
  const queue = [];
  return function runExclusive(task) {
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (active >= max) { queue.push(attempt); return; }
        active++;
        task().then(resolve, reject).finally(() => {
          active--;
          const next = queue.shift();
          if (next) next();
        });
      };
      attempt();
    });
  };
}
const runExclusive = createLimiter(MAX_CONCURRENCY);
const runYtDlpExclusive = createLimiter(YTDLP_MAX_CONCURRENCY);

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

// Plages non routables sur Internet — même esprit que le garde-fou SSRF
// d'apps/web (lib/security/safeFetch.ts), réimplémenté en léger ici : les
// deux services sont indépendants (gif-worker n'a aucune dépendance sur
// apps/web). yt-dlp fait ensuite ses propres requêtes (et suit lui-même
// ses redirections) : ce contrôle porte sur l'URL fournie, pas sur chaque
// saut de redirection — risque résiduel assumé, pas une garantie absolue.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || b === 0)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const addr = ip.toLowerCase();
    if (addr === "::1" || addr === "::") return true;
    if (addr.startsWith("fc") || addr.startsWith("fd") || addr.startsWith("fe80")) return true;
    const v4 = addr.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
    return v4 ? isPrivateIp(v4) : false;
  }
  return true; // ni IPv4 ni IPv6 → refusé par défaut
}

async function assertPublicVideoUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL invalide");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Seuls http et https sont acceptés");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Adresse réseau interne refusée");
    return url;
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new Error("Hôte introuvable");
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error("Adresse réseau interne refusée");
  }
  return url;
}

// Lance yt-dlp, capture stdout (JSON des métadonnées, ou rien pour un
// téléchargement) et stderr (message d'erreur exploitable côté appelant).
// Stdout plafonné : -J sur une vidéo seule (--no-playlist) tient très
// largement dans cette marge ; ça évite un stdout démesuré de saturer la
// mémoire sur une URL inattendue.
function runYtDlp(args, { timeoutMs, captureStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, args, { stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"] });
    let stdout = "";
    let stderr = "";
    if (captureStdout) {
      proc.stdout.on("data", (d) => { if (stdout.length < 5_000_000) stdout += d.toString(); });
    }
    proc.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
    const killer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.on("error", (err) => { clearTimeout(killer); reject(err); });
    proc.on("close", (code) => {
      clearTimeout(killer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp a échoué (code ${code}): ${stderr.slice(-2000) || "raison inconnue"}`));
    });
  });
}

// yt-dlp ne donne pas toujours un poids direct (`filesize`/`filesize_approx`
// manquent souvent sur les sources HLS/DASH, fréquentes sur TikTok/Instagram)
// — repli sur une estimation débit × durée quand elle est disponible.
// `null` = aucune estimation possible ; le poids réel reste de toute façon
// plafonné au téléchargement (MAX_FETCH_BYTES + vérif après coup).
function estimateApproxBytes(info) {
  if (typeof info.filesize_approx === "number") return info.filesize_approx;
  if (typeof info.filesize === "number") return info.filesize;
  const duration = Number(info.duration) || 0;
  const tbr = Number(info.tbr) || 0; // kbit/s
  if (duration && tbr) return Math.round((tbr * 1000 / 8) * duration);
  return null;
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

// JSON uniquement pour /meta-url et /fetch-url (ignoré pour le multipart de
// /convert — Content-Type différent, multer s'en occupe).
app.use(express.json({ limit: "10kb" }));

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

// Métadonnées d'une vidéo par lien — AUCUN téléchargement (yt-dlp -J
// --skip-download). Appelé server-à-serveur par apps/web
// (/api/video-link/ticket) avant d'émettre un ticket, pour rejeter tôt les
// vidéos trop longues/lourdes sans consommer de bande passante.
app.post("/meta-url", requireAuth, async (req, res) => {
  try {
    const rawUrl = String(req.body?.url || "");
    const url = await assertPublicVideoUrl(rawUrl);

    const stdout = await runYtDlpExclusive(() =>
      runYtDlp(
        ["-J", "--no-warnings", "--no-playlist", "--skip-download", url.toString()],
        { timeoutMs: META_TIMEOUT_MS, captureStdout: true },
      ),
    );
    const info = JSON.parse(stdout);
    res.json({
      title: info.title || null,
      durationS: Number(info.duration) || 0,
      approxBytes: estimateApproxBytes(info),
    });
  } catch (err) {
    console.error("[meta-url]", err);
    res.status(422).json({ error: "meta_failed", message: String(err.message || err) });
  }
});

// Téléchargement complet d'une vidéo par lien (TikTok / Instagram /
// générique) via yt-dlp, streamé en réponse — le navigateur la reçoit
// comme un Blob et la passe à VideoTrimModal exactement comme un fichier
// local. Jamais exposée sans ticket : AUTHORIZATION requireAuth, comme
// /convert. Le poids/la durée sont le véritable garde-fou ICI (MAX_FETCH_*
// ci-dessus) — le ticket émis par apps/web n'est pas lié à une URL
// précise, tout comme pour /convert.
app.post("/fetch-url", requireAuth, async (req, res) => {
  const workDir = await mkdtemp(path.join(tmpdir(), "ytdlp-"));
  const cleanup = () => rm(workDir, { recursive: true, force: true }).catch(() => {});
  try {
    const rawUrl = String(req.body?.url || "");
    const url = await assertPublicVideoUrl(rawUrl);

    const outputTemplate = path.join(workDir, "video.%(ext)s");
    await runYtDlpExclusive(() =>
      runYtDlp(
        [
          "--no-warnings", "--no-playlist",
          // Flux combiné déjà muxé plutôt que piste vidéo+audio séparées à
          // fusionner : certains itags mp4 haute résolution renvoient un 403
          // de googlevideo.com depuis une IP de datacenter (PO token exigé),
          // alors que le flux combiné "best" passe — testé en prod 2026-10-20,
          // voir la section Déploiement du README. Qualité suffisante de
          // toute façon : tout repart en GIF basse résolution derrière.
          "-f", "b[ext=mp4]/b",
          "--max-filesize", String(MAX_FETCH_BYTES),
          "--match-filter", `duration <= ${MAX_FETCH_DURATION_S}`,
          "--socket-timeout", "20",
          "-o", outputTemplate,
          url.toString(),
        ],
        { timeoutMs: FETCH_TIMEOUT_MS },
      ),
    );

    const files = await readdir(workDir);
    const videoFile = files.find((f) => f.startsWith("video."));
    if (!videoFile) throw new Error("Téléchargement vide — vidéo introuvable ou refusée par la plateforme.");

    const fullPath = path.join(workDir, videoFile);
    const { size } = await stat(fullPath);
    if (size > MAX_FETCH_BYTES) {
      await cleanup();
      return res.status(413).json({ error: "too_large", maxBytes: MAX_FETCH_BYTES });
    }

    const ext = path.extname(videoFile).slice(1).toLowerCase();
    const mime = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska" }[ext] || "video/mp4";
    res.set("Content-Type", mime);
    res.set("Content-Length", String(size));
    const { createReadStream } = await import("node:fs");
    const stream = createReadStream(fullPath);
    stream.pipe(res);
    stream.on("close", cleanup);
    stream.on("error", cleanup);
  } catch (err) {
    console.error("[fetch-url]", err);
    res.status(502).json({ error: "fetch_failed", message: String(err.message || err) });
    cleanup();
  }
});

// Téléchargement d'une SECTION seulement d'une vidéo YouTube (#7) — jamais
// la vidéo entière (potentiellement longue, contrairement à TikTok/
// Instagram) : yt-dlp --download-sections ne récupère que la plage
// [start, end] choisie par l'utilisateur dans le lecteur embarqué, avant
// même de télécharger quoi que ce soit. Mêmes garde-fous que /fetch-url
// (ticket, nettoyage systématique, limiteur de concurrence dédié à yt-dlp).
app.post("/fetch-url-section", requireAuth, async (req, res) => {
  const workDir = await mkdtemp(path.join(tmpdir(), "ytdlp-section-"));
  const cleanup = () => rm(workDir, { recursive: true, force: true }).catch(() => {});
  try {
    const rawUrl = String(req.body?.url || "");
    const url = await assertPublicVideoUrl(rawUrl);
    const start = Number(req.body?.start);
    const end = Number(req.body?.end);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start) {
      return res.status(400).json({ error: "bad_range" });
    }
    if (end - start > MAX_FETCH_SECTION_DURATION_S) {
      return res.status(400).json({ error: "section_too_long", maxSeconds: MAX_FETCH_SECTION_DURATION_S });
    }

    const outputTemplate = path.join(workDir, "video.%(ext)s");
    await runYtDlpExclusive(() =>
      runYtDlp(
        [
          "--no-warnings", "--no-playlist",
          // Voir le commentaire identique dans /fetch-url ci-dessus (403
          // googlevideo.com sur les itags mp4 séparés depuis cette IP VPS).
          "-f", "b[ext=mp4]/b",
          "--download-sections", `*${start}-${end}`,
          "--max-filesize", String(MAX_FETCH_BYTES),
          "--socket-timeout", "20",
          "-o", outputTemplate,
          url.toString(),
        ],
        { timeoutMs: FETCH_TIMEOUT_MS },
      ),
    );

    const files = await readdir(workDir);
    const videoFile = files.find((f) => f.startsWith("video."));
    if (!videoFile) throw new Error("Téléchargement vide — section introuvable ou vidéo refusée.");

    const fullPath = path.join(workDir, videoFile);
    const { size } = await stat(fullPath);
    if (size > MAX_FETCH_BYTES) {
      await cleanup();
      return res.status(413).json({ error: "too_large", maxBytes: MAX_FETCH_BYTES });
    }

    const ext = path.extname(videoFile).slice(1).toLowerCase();
    const mime = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska" }[ext] || "video/mp4";
    res.set("Content-Type", mime);
    res.set("Content-Length", String(size));
    const { createReadStream } = await import("node:fs");
    const stream = createReadStream(fullPath);
    stream.pipe(res);
    stream.on("close", cleanup);
    stream.on("error", cleanup);
  } catch (err) {
    console.error("[fetch-url-section]", err);
    res.status(502).json({ error: "fetch_failed", message: String(err.message || err) });
    cleanup();
  }
});

// Erreurs non interceptées plus haut (ex. mkdtemp).
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`gif-worker à l'écoute sur :${PORT} (ffmpeg max ${MAX_CONCURRENCY}, durée max ${MAX_DURATION_S}s ; yt-dlp max ${YTDLP_MAX_CONCURRENCY}, ${MAX_FETCH_DURATION_S}s/${Math.round(MAX_FETCH_BYTES / 1024 / 1024)}Mo ; section YouTube max ${MAX_FETCH_SECTION_DURATION_S}s)`);
});
