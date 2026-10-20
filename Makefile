# Common tasks. Run `make help` for the list.
PY ?= .venv/bin/python
PIP ?= .venv/bin/pip

.DEFAULT_GOAL := help
.PHONY: help install env db run web worker research-image test check build e2e docker-up docker-down

help: ## Show this list
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

install: ## Create .venv and install backend and frontend dependencies
	python3 -m venv .venv
	$(PIP) install -r backend/requirements-dev.txt
	npm --prefix frontend ci --ignore-scripts
	npm --prefix agent-runtime ci --ignore-scripts

env: ## Create .env from the example if there is none
	@test -f .env || cp .env.example .env

db: env ## Apply database migrations
	set -a; . ./.env; set +a; .venv/bin/alembic upgrade head

build: ## Build the frontend (served by the API)
	npm --prefix frontend run build

run: env ## Run the API and the built frontend on http://127.0.0.1:8765
	./scripts/run.sh

web: ## Run the frontend dev server with hot reload on http://127.0.0.1:5173
	npm --prefix frontend run dev

worker: env ## Run the assistant worker (reading guides, quizzes, page translation, the assistant)
	set -a; . ./.env; set +a; $(PY) -m backend.agent_worker

research-image: ## Build the image for the Docker research environment (optional)
	docker build -f deploy/Dockerfile.research-sandbox -t open-research-sandbox:1 .

test: ## Backend tests
	$(PY) -m pytest -q

check: ## Type-check and format-check the frontend
	npm --prefix frontend run check

e2e: build ## Browser tests (needs: npx playwright install chromium)
	npm --prefix frontend run test:e2e

docker-up: env ## Build and start the Docker Compose stack
	docker compose up -d --build

docker-down: ## Stop the Docker Compose stack (data volumes are kept)
	docker compose down
