# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: builder — install Python deps into /install so final image stays lean
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12 AS builder

WORKDIR /install

# System libs needed to *compile* some wheels (psycopg2-binary, lxml, Pillow, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libpq-dev \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install --prefix=/install --no-cache-dir -r requirements.txt


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: runtime — only what's needed to run the app
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12 AS runtime

# Labels
LABEL maintainer="scribe-team"
LABEL description="Scribe AI Document Editor — FastAPI backend + Celery worker"

# ── System runtime deps ────────────────────────────────────────────────────
#   tesseract-ocr     → pytesseract OCR engine
#   libpq5            → psycopg2 runtime
#   poppler-utils     → PDF utilities (PyMuPDF uses libmupdf directly, kept for compat)
#   libgl1            → OpenCV / Pillow headless rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    libpq5 \
    poppler-utils \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Copy installed Python packages from builder ────────────────────────────
COPY --from=builder /install /usr/local

# ── App source ─────────────────────────────────────────────────────────────
WORKDIR /code
COPY . .

# ── Non-root user (security best-practice) ─────────────────────────────────
RUN useradd --no-create-home --shell /bin/false scribe \
    && mkdir -p /tmp/huggingface \
    && chown -R scribe:scribe /code /tmp/huggingface
USER scribe

# ── Default env (overridden by docker-compose / .env) ──────────────────────
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/code

# ── Health check — hits /health endpoint ───────────────────────────────────
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

# ── Entrypoint: waits for Postgres, then hands off to CMD ──────────────────
COPY --chown=scribe:scribe scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

# Default CMD: API server (docker-compose overrides this for the worker)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
