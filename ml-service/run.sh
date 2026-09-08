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

# Invoke the venv interpreter DIRECTLY rather than sourcing .venv/bin/activate.
# A virtualenv is not relocatable: activate hardcodes an absolute VIRTUAL_ENV,
# and the PharmaIQ -> PharmaZs directory rename left it pointing at a path that
# no longer exists. Sourcing it then put a stale directory on PATH and `python`
# resolved to some other interpreter with no uvicorn installed. `.venv/bin/python`
# is a symlink to the real interpreter and works regardless of where the project
# lives. (The venv's console scripts — pip, pytest, fastapi — still carry stale
# shebangs; use `.venv/bin/python -m <tool>` for those, or recreate the venv.)
exec .venv/bin/python -m uvicorn app.main:app \
  --host "${ML_HOST:-127.0.0.1}" \
  --port "${ML_PORT:-8000}" "$@"
