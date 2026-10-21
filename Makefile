# Common tasks. Run `make help` for the list.
PY ?= .venv/bin/python
PIP ?= .venv/bin/pip

.DEFAULT_GOAL := help
.PHONY: help start desktop-dev desktop install env db run web worker research-image test check build e2e docker-up docker-down

help: ## Show this list
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

start: .venv/.installed frontend/node_modules/.installed agent-runtime/node_modules/.installed frontend/dist/index.html ## Install what is missing, build what changed, and open the app (PORT=8765)
	$(PY) -m backend.local --port $(or $(PORT),8765)

# What `start` needs, each redone only when what it comes from has changed.
.venv/.installed: backend/requirements.txt backend/requirements-dev.txt
	test -x $(PY) || python3 -m venv .venv
	$(PIP) install -q -r backend/requirements-dev.txt
	touch $@

frontend/node_modules/.installed: frontend/package-lock.json
	npm --prefix frontend ci --ignore-scripts
	touch $@

agent-runtime/node_modules/.installed: agent-runtime/package-lock.json
	npm --prefix agent-runtime ci --ignore-scripts
	touch $@

frontend/dist/index.html: frontend/node_modules/.installed frontend/index.html frontend/vite.config.ts $(shell find frontend/src frontend/public -type f 2>/dev/null)
	npm --prefix frontend run build

desktop-dev: .venv/.installed frontend/node_modules/.installed agent-runtime/node_modules/.installed frontend/dist/index.html desktop/node_modules/.installed ## Open the desktop app from the source tree (no packaging)
	cd desktop && npx electron .

desktop: desktop/node_modules/.installed ## Build the desktop app for this Mac: desktop/dist/*.dmg
	bash desktop/scripts/bundle-python.sh
	cd desktop && npx electron-builder --mac dmg

desktop/node_modules/.installed: desktop/package-lock.json
	npm --prefix desktop ci
	touch $@

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
