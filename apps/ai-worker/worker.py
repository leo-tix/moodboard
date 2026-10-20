"""
Worker IA continue — tourne en permanence sur le VPS partagé, traite les
Inspiration en file "aiStatus=PENDING" (nouveaux uploads ET backfill, même
requête de claim). Phase 2 : embedding + tags (banque élargie, voir
tag_vocab.py) + catégories (zero-shot dynamique contre les vraies
catégories/sous-catégories en base) + détection de doublons (pgvector KNN).

Discipline ressources : une Inspiration à la fois (pas de concurrence
interne à sérialiser), threads BLAS/torch bridés à 1 — c'est le vrai
mécanisme anti-saturation, en complément du cap `cpus` du compose.yaml.
Ne jamais retirer les lignes os.environ ci-dessous ni les déplacer après
l'import de torch (elles doivent être posées avant que torch/BLAS les lisent).
"""

import os

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

import io
import logging
import signal
import threading
import time
import uuid

import psycopg
import requests
import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor

from http.server import BaseHTTPRequestHandler, HTTPServer

from scoring import map_categories, map_tags
from tag_vocab import TAG_GROUPS

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("ai-worker")

torch.set_num_threads(1)

DATABASE_URL = os.environ["DATABASE_URL"]
R2_PUBLIC_URL = os.environ["R2_PUBLIC_URL"].rstrip("/")
SIGLIP_MODEL_ID = os.environ.get("SIGLIP_MODEL_ID", "google/siglip-large-patch16-256")
POLL_INTERVAL_MS = int(os.environ.get("POLL_INTERVAL_MS", "5000"))
RECLAIM_INTERVAL_S = int(os.environ.get("RECLAIM_INTERVAL_S", "600"))
RECLAIM_STALE_MINUTES = int(os.environ.get("RECLAIM_STALE_MINUTES", "30"))
CATEGORY_REFRESH_INTERVAL_S = int(os.environ.get("CATEGORY_REFRESH_INTERVAL_S", "1800"))
HEALTH_PORT = int(os.environ.get("HEALTH_PORT", "8092"))
HTTP_TIMEOUT_S = int(os.environ.get("HTTP_TIMEOUT_S", "20"))
TEXT_BATCH_SIZE = int(os.environ.get("TEXT_BATCH_SIZE", "32"))
# Seuil STRICT de similarité cosinus pour "quasi-doublon" — volontairement
# conservateur au départ (quasi-identique uniquement), à ajuster une fois
# testé sur de vraies paires connues (voir plan Phase 2). Le seuil LARGE
# "images proches" n'est pas géré ici : calculé à la lecture (Phase 5),
# jamais persisté.
DUPLICATE_THRESHOLD = float(os.environ.get("DUPLICATE_THRESHOLD", "0.97"))
DUPLICATE_CANDIDATES_LIMIT = int(os.environ.get("DUPLICATE_CANDIDATES_LIMIT", "8"))

TEMPLATES = [
    "This is a photo of {}.",
    "This is an image of {}.",
    "This is a picture of {}.",
]

_stop = threading.Event()
_health_ok = threading.Event()


def image_url(storage_key: str) -> str:
    if storage_key.startswith("http://") or storage_key.startswith("https://"):
        return storage_key
    return f"{R2_PUBLIC_URL}/{storage_key}"


def connect():
    return psycopg.connect(DATABASE_URL, autocommit=True)


def reclaim_stale(conn):
    cur = conn.execute(
        """
        UPDATE inspirations
        SET "aiStatus" = 'PENDING', "updatedAt" = now()
        WHERE "aiStatus" = 'PROCESSING'
          AND "updatedAt" < now() - interval '%s minutes'
        """
        % RECLAIM_STALE_MINUTES
    )
    if cur.rowcount:
        log.warning("reclaimed %s stuck PROCESSING row(s)", cur.rowcount)


def claim_next(conn) -> str | None:
    cur = conn.execute(
        """
        UPDATE inspirations
        SET "aiStatus" = 'PROCESSING', "updatedAt" = now()
        WHERE id = (
            SELECT id FROM inspirations
            WHERE "aiStatus" = 'PENDING'
            ORDER BY "createdAt" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING id
        """
    )
    row = cur.fetchone()
    return row[0] if row else None


def fetch_main_image(conn, inspiration_id: str):
    cur = conn.execute(
        """
        SELECT i."storageKey", insp."userId"
        FROM images i
        JOIN inspirations insp ON insp.id = i."inspirationId"
        WHERE i."inspirationId" = %s AND i."isMain" = true
        LIMIT 1
        """,
        (inspiration_id,),
    )
    row = cur.fetchone()
    return (row[0], row[1]) if row else (None, None)


def mark_error(conn, inspiration_id: str, message: str):
    conn.execute(
        """
        UPDATE inspirations
        SET "aiStatus" = 'ERROR', "aiError" = %s, "updatedAt" = now()
        WHERE id = %s
        """,
        (message[:500], inspiration_id),
    )


def mark_done(conn, inspiration_id: str, embedding: list[float], tags: list[dict], categories: list[dict]):
    import json

    vector_literal = "[" + ",".join(repr(float(x)) for x in embedding) + "]"
    conn.execute(
        """
        UPDATE inspirations
        SET embedding = %s::vector,
            "aiSuggestedTags" = %s::jsonb,
            "aiSuggestedCategories" = %s::jsonb,
            "aiStatus" = 'DONE',
            "aiAnalyzedAt" = now(),
            "aiError" = NULL,
            "updatedAt" = now()
        WHERE id = %s
        """,
        (vector_literal, json.dumps(tags), json.dumps(categories), inspiration_id),
    )


def find_and_record_duplicates(conn, inspiration_id: str, user_id: str, embedding: list[float]):
    vector_literal = "[" + ",".join(repr(float(x)) for x in embedding) + "]"
    cur = conn.execute(
        """
        SELECT id, 1 - (embedding <=> %s::vector) AS similarity
        FROM inspirations
        WHERE "userId" = %s AND id != %s AND embedding IS NOT NULL
        ORDER BY embedding <=> %s::vector
        LIMIT %s
        """,
        (vector_literal, user_id, inspiration_id, vector_literal, DUPLICATE_CANDIDATES_LIMIT),
    )
    for other_id, similarity in cur.fetchall():
        if similarity < DUPLICATE_THRESHOLD:
            continue
        a_id, b_id = sorted([inspiration_id, other_id])
        conn.execute(
            """
            INSERT INTO duplicate_candidates
                (id, "inspirationAId", "inspirationBId", similarity, status, "createdAt", "updatedAt")
            VALUES (%s, %s, %s, %s, 'PENDING', now(), now())
            ON CONFLICT ("inspirationAId", "inspirationBId")
            DO UPDATE SET similarity = EXCLUDED.similarity, "updatedAt" = now()
            """,
            (uuid.uuid4().hex, a_id, b_id, float(similarity)),
        )
        log.info("duplicate candidate: %s ~ %s (similarity=%.4f)", a_id, b_id, similarity)


def fetch_category_rows(conn) -> list[dict]:
    cur = conn.execute(
        """
        SELECT c.id AS "categoryId", c.name AS "categoryName",
               s.id AS "subcategoryId", s.name AS "subcategoryName"
        FROM categories c
        LEFT JOIN subcategories s ON s."categoryId" = c.id
        ORDER BY c."order", s."order"
        """
    )
    rows = []
    for category_id, category_name, subcategory_id, subcategory_name in cur.fetchall():
        if subcategory_name:
            text = f"{subcategory_name.lower()}, a type of {category_name.lower()}"
        else:
            text = category_name.lower()
        rows.append(
            {
                "categoryId": category_id,
                "subcategoryId": subcategory_id,
                "text": text,
            }
        )
    return rows


class Backbone:
    """SigLIP-large, chargé une seule fois et gardé résident pour toute la
    durée de vie du process (le chargement seul prend ~2 min la première
    fois, le reste du temps c'est le cache HF monté en volume qui sert)."""

    def __init__(self, model_id: str):
        log.info("loading backbone %s ...", model_id)
        t0 = time.time()
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.model = AutoModel.from_pretrained(model_id)
        self.model.eval()
        log.info("backbone loaded in %.1fs", time.time() - t0)

    @torch.no_grad()
    def embed_image(self, img: Image.Image) -> list[float]:
        inputs = self.processor(images=img, return_tensors="pt")
        out = self.model.get_image_features(**inputs)
        vec = out.pooler_output if hasattr(out, "pooler_output") else out
        return vec[0].tolist()

    @torch.no_grad()
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Encode chaque texte avec les 3 gabarits de `TEMPLATES`, moyenne +
        L2-normalise — même principe d'ensembling que l'ancien système
        navigateur (`siglipText`/`PROMPT_TEMPLATES`). N'assume pas la
        dimension de sortie à l'avance (dépend du modèle), accumule au lieu
        de pré-allouer.

        LENT en CPU single-thread : la tour texte de SigLIP-large prend
        ~27s par batch de 32 (mesuré sur ce VPS) — pour ~330 concepts × 3
        gabarits ça représenterait ~15-20 min À CHAQUE appel sans le cache
        disque géré par `Vocab` (voir `_load_or_build_tag_embeds`). Log de
        progression ci-dessous pour que ce ne soit jamais silencieux."""
        n_batches_total = len(TEMPLATES) * (-(-len(texts) // TEXT_BATCH_SIZE))
        done = 0
        template_sums = None
        for template in TEMPLATES:
            templated = [template.format(t) for t in texts]
            batch_vecs = []
            for i in range(0, len(templated), TEXT_BATCH_SIZE):
                chunk = templated[i : i + TEXT_BATCH_SIZE]
                inputs = self.processor(text=chunk, padding="max_length", truncation=True, return_tensors="pt")
                out = self.model.get_text_features(**inputs)
                vec = out.pooler_output if hasattr(out, "pooler_output") else out
                batch_vecs.append(vec)
                done += 1
                log.info("  text batch %d/%d", done, n_batches_total)
            template_vecs = torch.cat(batch_vecs, dim=0)
            template_sums = template_vecs if template_sums is None else template_sums + template_vecs
        avg = template_sums / len(TEMPLATES)
        avg = torch.nn.functional.normalize(avg, dim=-1)
        return avg.tolist()


def load_image(storage_key: str) -> Image.Image:
    resp = requests.get(image_url(storage_key), timeout=HTTP_TIMEOUT_S)
    resp.raise_for_status()
    # PIL ouvre la frame 0 par défaut pour un GIF animé — aucune extraction
    # ffmpeg nécessaire, toute vidéo importée est déjà convertie en GIF
    # avant d'exister comme Image (voir apps/gif-worker).
    img = Image.open(io.BytesIO(resp.content))
    return img.convert("RGB")


VOCAB_CACHE_DIR = os.environ.get("VOCAB_CACHE_DIR", "/home/appuser/.cache/ai-worker")


def _concepts_hash(prompts: list[str], model_id: str) -> str:
    import hashlib

    raw = model_id + "\n" + "\n".join(prompts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


class Vocab:
    """Concepts tags (statiques, `tag_vocab.py`) + catégories (dynamiques,
    rechargées depuis la base). Embeddings texte TRÈS coûteux à calculer sur
    ce VPS (~27s/batch de 32, tour texte SigLIP-large en CPU single-thread —
    voir `Backbone.embed_texts`) : les tags sont mis en cache sur disque
    (volume `ai_worker_vocab_cache`, invalidé seulement si `tag_vocab.py`
    change) pour ne payer ce coût qu'une fois par version du vocabulaire,
    jamais à chaque redémarrage. Les catégories ne sont ré-embedées que si
    leur contenu a réellement changé depuis le dernier calcul (comparaison
    de hash avant tout recalcul), pas sur un simple minuteur."""

    def __init__(self, backbone: Backbone, model_id: str):
        self.backbone = backbone
        self.model_id = model_id
        self.tag_concepts = [
            {"label": t["label"], "group": group}
            for group, tags in TAG_GROUPS.items()
            for t in tags
        ]
        tag_prompts = [t["prompt"] for tags in TAG_GROUPS.values() for t in tags]
        self.tag_embeds = torch.tensor(self._load_or_build_tag_embeds(tag_prompts))
        self.category_concepts: list[dict] = []
        self.category_embeds = torch.zeros(0, self.tag_embeds.shape[-1])
        self._category_hash: str | None = None

    def _load_or_build_tag_embeds(self, tag_prompts: list[str]) -> list[list[float]]:
        import json
        import os as _os

        _os.makedirs(VOCAB_CACHE_DIR, exist_ok=True)
        cache_key = _concepts_hash(tag_prompts, self.model_id)
        cache_path = _os.path.join(VOCAB_CACHE_DIR, f"tag_embeds_{cache_key}.json")
        if _os.path.exists(cache_path):
            log.info("loading %d tag embeddings from cache (%s)", len(tag_prompts), cache_path)
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        log.info("embedding %d tag concepts (no cache, ~27s/batch of %d on this VPS) ...", len(tag_prompts), TEXT_BATCH_SIZE)
        embeds = self.backbone.embed_texts(tag_prompts)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(embeds, f)
        log.info("tag embeddings cached to %s", cache_path)
        return embeds

    def refresh_categories(self, conn):
        rows = fetch_category_rows(conn)
        if not rows:
            log.warning("no categories found in DB, category suggestions disabled")
            self.category_concepts = []
            self.category_embeds = torch.zeros(0, self.tag_embeds.shape[-1])
            self._category_hash = None
            return
        new_hash = _concepts_hash([r["text"] for r in rows], self.model_id)
        if new_hash == self._category_hash:
            return  # contenu identique au dernier calcul, pas la peine de ré-embedder
        log.info("embedding %d category concepts (content changed since last check) ...", len(rows))
        embeds = self.backbone.embed_texts([r["text"] for r in rows])
        self.category_concepts = rows
        self.category_embeds = torch.tensor(embeds)
        self._category_hash = new_hash

    def score_tags(self, image_embed: torch.Tensor) -> list[dict]:
        scores = (self.tag_embeds @ image_embed).tolist()
        return map_tags(scores, self.tag_concepts)

    def score_categories(self, image_embed: torch.Tensor) -> list[dict]:
        if self.category_embeds.shape[0] == 0:
            return []
        scores = (self.category_embeds @ image_embed).tolist()
        return map_categories(scores, self.category_concepts)


def process_one(conn, backbone: Backbone, vocab: Vocab, inspiration_id: str):
    storage_key, user_id = fetch_main_image(conn, inspiration_id)
    if not storage_key:
        mark_error(conn, inspiration_id, "no_main_image")
        log.warning("inspiration %s: no main image, marked ERROR", inspiration_id)
        return
    try:
        img = load_image(storage_key)
        embedding = backbone.embed_image(img)
        image_vec = torch.nn.functional.normalize(torch.tensor(embedding), dim=-1)
        tags = vocab.score_tags(image_vec)
        categories = vocab.score_categories(image_vec)
    except Exception as exc:  # noqa: BLE001 - on veut toujours libérer le slot
        mark_error(conn, inspiration_id, f"{type(exc).__name__}: {exc}")
        log.exception("inspiration %s failed", inspiration_id)
        return
    mark_done(conn, inspiration_id, embedding, tags, categories)
    find_and_record_duplicates(conn, inspiration_id, user_id, embedding)
    log.info(
        "inspiration %s done (dim=%d, tags=%d, categories=%d)",
        inspiration_id, len(embedding), len(tags), len(categories),
    )


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - signature imposée par BaseHTTPRequestHandler
        if self.path == "/health":
            ok = _health_ok.is_set()
            self.send_response(200 if ok else 503)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok": %s}' % (b"true" if ok else b"false"))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):  # noqa: A002 - silence le log par défaut
        pass


def serve_health():
    server = HTTPServer(("127.0.0.1", HEALTH_PORT), HealthHandler)
    server.serve_forever()


def handle_signal(signum, _frame):
    log.info("received signal %s, stopping after current job", signum)
    _stop.set()


def main():
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    threading.Thread(target=serve_health, daemon=True).start()

    backbone = Backbone(SIGLIP_MODEL_ID)

    last_reclaim = 0.0
    last_category_refresh = 0.0
    with connect() as conn:
        vocab = Vocab(backbone, SIGLIP_MODEL_ID)
        vocab.refresh_categories(conn)
        last_category_refresh = time.time()
        _health_ok.set()

        while not _stop.is_set():
            now = time.time()
            if now - last_reclaim > RECLAIM_INTERVAL_S:
                reclaim_stale(conn)
                last_reclaim = now
            if now - last_category_refresh > CATEGORY_REFRESH_INTERVAL_S:
                vocab.refresh_categories(conn)
                last_category_refresh = now

            inspiration_id = claim_next(conn)
            if inspiration_id is None:
                time.sleep(POLL_INTERVAL_MS / 1000)
                continue

            log.info("claimed inspiration %s", inspiration_id)
            process_one(conn, backbone, vocab, inspiration_id)

    log.info("stopped")


if __name__ == "__main__":
    main()
