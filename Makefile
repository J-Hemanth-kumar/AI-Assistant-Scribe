# ─────────────────────────────────────────────────────────────────────────────
# Scribe — Makefile
# Usage: make <target>
# ─────────────────────────────────────────────────────────────────────────────

.PHONY: help build up down restart logs logs-api logs-worker \
        shell-api shell-worker shell-db \
        ps health rebuild nuke

# Detect docker compose v2 vs legacy
COMPOSE := $(shell docker compose version > /dev/null 2>&1 && echo "docker compose" || echo "docker-compose")

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Build ─────────────────────────────────────────────────────────────────────

build: ## Build backend Docker image (no cache)
	$(COMPOSE) build --no-cache api worker

build-fast: ## Build backend Docker image (with cache)
	$(COMPOSE) build api worker

# ── Start / Stop ──────────────────────────────────────────────────────────────

up: ## Start all services in the background
	$(COMPOSE) up -d

up-infra: ## Start only infrastructure (postgres, redis, minio, qdrant)
	$(COMPOSE) up -d postgres redis minio qdrant mc

down: ## Stop all containers (keep volumes)
	$(COMPOSE) down

restart: ## Restart API and worker only
	$(COMPOSE) restart api worker

# ── Logs ──────────────────────────────────────────────────────────────────────

logs: ## Tail logs from all services
	$(COMPOSE) logs -f

logs-api: ## Tail API server logs
	$(COMPOSE) logs -f api

logs-worker: ## Tail Celery worker logs
	$(COMPOSE) logs -f worker

logs-db: ## Tail Postgres logs
	$(COMPOSE) logs -f postgres

# ── Status ────────────────────────────────────────────────────────────────────

ps: ## Show running containers and their status
	$(COMPOSE) ps

health: ## Print health status of every container
	@echo "\n=== Container Health ==="
	@$(COMPOSE) ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# ── Shells ────────────────────────────────────────────────────────────────────

shell-api: ## Open a shell inside the API container
	$(COMPOSE) exec api /bin/sh

shell-worker: ## Open a shell inside the worker container
	$(COMPOSE) exec worker /bin/sh

shell-db: ## Open psql inside Postgres
	$(COMPOSE) exec postgres psql -U documentparser documentparser

# ── Maintenance ───────────────────────────────────────────────────────────────

rebuild: ## Full rebuild + restart (keeps volumes)
	$(COMPOSE) down
	$(COMPOSE) build --no-cache api worker
	$(COMPOSE) up -d

nuke: ## ⚠ Destroy everything including volumes (data loss!)
	$(COMPOSE) down -v --remove-orphans
	docker image rm scribe_backend:latest 2>/dev/null || true
