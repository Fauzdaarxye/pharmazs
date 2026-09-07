#!/usr/bin/env bash
# Start the PharmaZs ML service.
#
# Defaults to 127.0.0.1 because this service is INTERNAL — it is reached solely
# by the Node API (CONTRACT.md §1) and must never be exposed publicly.
#
# ML_HOST is overridable for containers only: inside Docker/Railway the API runs
# in a DIFFERENT network namespace, so a hard 127.0.0.1 bind is unreachable and
# the API reports the analytics service as down. Set ML_HOST=0.0.0.0 there and
# keep the service off any public router/ingress instead.
set -euo pipefail
cd "$(dirname "$0")"
source .venv/bin/activate
exec python -m uvicorn app.main:app \
  --host "${ML_HOST:-127.0.0.1}" \
  --port "${ML_PORT:-8000}" "$@"
