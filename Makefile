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
db-migrate: ## Run SQL migrations
	PGPASSWORD=braice_secret psql -h localhost -p 5433 -U braice -d braice_db \
		-f database/migrations/001_init.sql

db-seed: ## Seed demo data via API (start API first)
	@echo "Creating creator..."
	@CREATOR=$$(curl -sf -X POST http://localhost:3001/api/users \
		-H 'Content-Type: application/json' \
		-d '{"displayName":"Afrobeat King","userType":"CREATOR","walletAddress":"wallet_demo_001"}' | \
		python3 -c "import sys,json;print(json.load(sys.stdin)['id'])"); \
	echo "Creator: $$CREATOR"; \
	echo "Creating community..."; \
	COMMUNITY=$$(curl -sf -X POST http://localhost:3001/api/communities \
		-H 'Content-Type: application/json' \
		-d "{\"name\":\"Afrobeat Creators\",\"description\":\"The largest afrobeat creator community\",\"operatorId\":\"$$CREATOR\",\"governanceConfig\":{\"approvalMode\":\"CREATOR_AND_THRESHOLD\",\"thresholdPercentage\":60}}" | \
		python3 -c "import sys,json;print(json.load(sys.stdin)['id'])"); \
	echo "Community: $$COMMUNITY"; \
	echo "Creating 100 members..."; \
	for i in $$(seq 1 100); do \
		curl -sf -X POST http://localhost:3001/api/users \
			-H 'Content-Type: application/json' \
			-d "{\"displayName\":\"Member $$i\",\"userType\":\"MEMBER\",\"walletAddress\":\"wallet_member_$$i\"}" > /dev/null; \
	done; \
	echo "Joining members to community..."; \
	MEMBER_IDS=$$(curl -sf http://localhost:3001/api/users | \
		python3 -c "import sys,json;[print(u['id']) for u in json.load(sys.stdin) if u['userType']=='MEMBER']"); \
	for MID in $$MEMBER_IDS; do \
		curl -sf -X POST "http://localhost:3001/api/communities/$$COMMUNITY/members" \
			-H 'Content-Type: application/json' \
			-d "{\"userId\":\"$$MID\"}" > /dev/null; \
	done; \
	echo "Generating 1000 activity records..."; \
	MEMBER_SAMPLE=$$(curl -sf http://localhost:3001/api/users | \
		python3 -c "import sys,json;users=[u['id'] for u in json.load(sys.stdin) if u['userType']=='MEMBER'];import random;print('\n'.join(random.choice(users) for _ in range(1000)))"); \
	CATS="streetwear music_festivals sneakers beauty food nightlife fitness art technology"; \
	TYPES="clicked viewed purchased bookmarked shared"; \
	echo "$$MEMBER_SAMPLE" | while read -r MID; do \
		CAT=$$(echo "$$CATS" | tr ' ' '\n' | shuf -n1); \
		TYP=$$(echo "$$TYPES" | tr ' ' '\n' | shuf -n1); \
		curl -sf -X POST "http://localhost:3001/api/communities/$$COMMUNITY/activity" \
			-H 'Content-Type: application/json' \
			-d "{\"memberId\":\"$$MID\",\"activityType\":\"$$TYP\",\"interestCategory\":\"$$CAT\",\"occurredAt\":\"2026-09-23T12:00:00Z\"}" > /dev/null; \
	done; \
	echo "Done! 100 members, 1000 activity records seeded."

# ─── Full lifecycle ────────────────────────────────────────
up: db-up ## Start everything (db + api)
	@sleep 1
	$(MAKE) build
	$(MAKE) dev

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
