# Worker IA continue — tagging/catégorisation/similarité self-hosted.
# CPU uniquement (pas de GPU sur ce VPS) : roue torch CPU explicite, sinon
# pip tire les dépendances CUDA (inutiles, énormes) depuis l'index par défaut.
FROM python:3.11-slim

RUN useradd --create-home --uid 1000 appuser

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

COPY worker.py scoring.py tag_vocab.py .

ENV HF_HOME=/home/appuser/.cache/huggingface
ENV VOCAB_CACHE_DIR=/home/appuser/.cache/ai-worker
RUN mkdir -p "$HF_HOME" "$VOCAB_CACHE_DIR" && chown -R appuser:appuser /app /home/appuser

USER appuser

CMD ["python", "worker.py"]
