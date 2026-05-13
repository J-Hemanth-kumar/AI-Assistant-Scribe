#!/bin/sh
set -e

echo "[entrypoint] Waiting for Postgres..."

until python -c "
import sys, os, psycopg2
url = os.environ['DATABASE_URL'].replace('postgresql+psycopg2://', 'postgresql://')
try:
    psycopg2.connect(url).close()
    sys.exit(0)
except Exception as e:
    sys.exit(1)
" 2>/dev/null; do
  echo "[entrypoint] Postgres not ready — retrying in 2s..."
  sleep 2
done

echo "[entrypoint] Postgres is ready."

if [ "$1" = "worker" ]; then
  echo "[entrypoint] Running DB init for worker..."
  python -c "from app.db.init_db import init_db; init_db()"
  shift   # ← remove "worker" from $@ so exec gets "celery -A ..." not "worker celery ..."
fi

echo "[entrypoint] Starting: $*"
exec "$@"