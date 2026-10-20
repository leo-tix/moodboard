"""
Transformation « scores zero-shot → suggestions ». Port Python de la logique
`apps/web/lib/ai/imageMap.mjs` (même principe : z-score adaptatif par image,
top-N par dimension pour les tags). Pas de "titres" ici — hors scope de
cette Phase (voir plan), seulement tags + catégories.
"""

from __future__ import annotations

import statistics

MAX_CATEGORIES = 3
MAX_TAGS = 14
PER_GROUP_KEEP = 2


def _zscores(scores: list[float]) -> list[float]:
    n = len(scores) or 1
    mean = sum(scores) / n
    std = statistics.pstdev(scores) or 1.0
    return [(s - mean) / std for s in scores]


def map_tags(scores: list[float], concepts: list[dict]) -> list[dict]:
    """`concepts` = [{label, group}, ...] aligné sur `scores`. Retourne le top
    de chaque dimension (`PER_GROUP_KEEP`), tri final par score, cap `MAX_TAGS`."""
    zs = _zscores(scores)
    by_group: dict[str, list[dict]] = {}
    for i, c in enumerate(concepts):
        by_group.setdefault(c["group"], []).append(
            {"label": c["label"], "score": scores[i], "z": zs[i], "group": c["group"]}
        )
    top_tags: list[dict] = []
    for arr in by_group.values():
        arr.sort(key=lambda t: t["score"], reverse=True)
        top_tags.extend(arr[:PER_GROUP_KEEP])
    top_tags.sort(key=lambda t: t["score"], reverse=True)
    return top_tags[:MAX_TAGS]


def map_categories(scores: list[float], concepts: list[dict]) -> list[dict]:
    """`concepts` = [{categoryId, subcategoryId}, ...] aligné sur `scores`.
    Retourne le top `MAX_CATEGORIES` par score brut (classement zero-shot
    fiable sur les catégories, l'utilisateur choisit parmi le top — même
    logique que l'ancien système)."""
    zs = _zscores(scores)
    out = [
        {
            "categoryId": c["categoryId"],
            "subcategoryId": c.get("subcategoryId"),
            "score": scores[i],
            "z": zs[i],
        }
        for i, c in enumerate(concepts)
    ]
    out.sort(key=lambda c: c["score"], reverse=True)
    return out[:MAX_CATEGORIES]
