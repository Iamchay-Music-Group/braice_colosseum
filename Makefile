.PHONY: help install build dev start test lint \
       db-up db-down db-migrate db-reset db-psql \
       db-seed seed-demo \
       up down restart logs status

# ─── Default ───────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ─── Setup ─────────────────────────────────────────────────
install: ## Install all dependencies
	pnpm install

build: ## Build the API
	pnpm build

# ─── Run ───────────────────────────────────────────────────
dev: ## Start API in watch mode
	pnpm dev

start: ## Start API (production)
	pnpm start

test: ## Run tests
	pnpm test

lint: ## Lint and fix
	pnpm lint

# ─── Docker ────────────────────────────────────────────────
db-up: ## Start Postgres in Docker
	docker-compose up -d
	@echo "Waiting for Postgres..."
	@sleep 2
	@docker-compose exec postgres pg_isready -U braice -d braice_db && echo "Postgres is ready"

db-down: ## Stop Postgres
	docker-compose down

db-reset: ## Stop Postgres, remove volume, restart
	docker-compose down -v
	docker-compose up -d
	@sleep 2
	@docker-compose exec postgres pg_isready -U braice -d braice_db && echo "Postgres is ready"

db-psql: ## Open psql shell
	docker-compose exec postgres psql -U braice -d braice_db

# ─── Database ──────────────────────────────────────────────
db-migrate: ## Run SQL migrations (all of database/migrations, in order, once)
	pnpm db:migrate

db-seed: ## Seed demo data via API (start API first)
	@bash scripts/seed-demo.sh

# ─── Full lifecycle ────────────────────────────────────────
up: db-up ## Start everything (db + api)
	@sleep 1
	$(MAKE) build
	cd apps/api && setsid node dist/main.js > /tmp/braice-api.log 2>&1 &
	@sleep 3
	@curl -sf http://localhost:3001/api/users > /dev/null && echo "API running on http://localhost:3001" || echo "API failed to start"

down: ## Stop everything
	@kill $$(lsof -ti:3001) 2>/dev/null || true
	$(MAKE) db-down

restart: down up ## Restart everything

# ─── Status ────────────────────────────────────────────────
logs: ## Tail API logs
	@tail -f /tmp/braice-api.log 2>/dev/null || echo "No log file found"

status: ## Check running services
	@echo "── Docker ──"
	@docker-compose ps 2>/dev/null || echo "Docker Compose not running"
	@echo "\n── API ──"
	@curl -sf http://localhost:3001/api/users > /dev/null 2>&1 && echo "API: running on :3001" || echo "API: not running"
	@curl -sf http://localhost:3001/docs > /dev/null 2>&1 && echo "Docs: http://localhost:3001/docs" || true
