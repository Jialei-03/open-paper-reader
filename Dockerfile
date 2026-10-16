# syntax=docker/dockerfile:1
#
# One image, three roles (see deploy/docker-entrypoint.sh):
#   web      the API and the built frontend            (default)
#   worker   the research-assistant worker (needs Node)
#   shell    anything else, e.g. `python -m backend.cli bootstrap`
#
#   docker build -t zhijian .

# ---------------------------------------------------------------- frontend
FROM node:22-bookworm-slim AS frontend
WORKDIR /build/frontend
ENV SCARF_ANALYTICS=false
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build

# ----------------------------------------------------------- agent runtime
FROM node:22-bookworm-slim AS agent
WORKDIR /build/agent-runtime
COPY agent-runtime/package.json agent-runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY agent-runtime/ ./

# --------------------------------------------------------------------- app
FROM python:3.13-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AGENT_NODE=/usr/local/bin/node \
    STORAGE_DIR=/data/files \
    FORWARDED_ALLOW_IPS=127.0.0.1
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY --from=agent /usr/local/bin/node /usr/local/bin/node
COPY --from=agent /build/agent-runtime/ agent-runtime/
COPY backend/ backend/
COPY alembic.ini ./
COPY --from=frontend /build/frontend/dist/ frontend/dist/
COPY docs/licenses/ licenses/
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
    && useradd --uid 10001 --create-home paper \
    && mkdir -p /data/files \
    && chown -R paper:paper /data
USER paper
VOLUME /data
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/v1/health', timeout=4)" || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["web"]
