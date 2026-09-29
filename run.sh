#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and replace the CHANGE_ME values first."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine and the Compose v2 plugin are required."
  exit 1
fi

docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 180

echo "EduOS ${EDUOS_VERSION:-1.0.0-rc.1} is starting."
echo "Open http://localhost:${EDUOS_HTTP_PORT:-8080} after the containers pass their health checks."
echo "The first-school admin credentials and school ID are the values in .env."
