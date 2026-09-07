#!/usr/bin/env bash
# Start the PharmaIQ ML service. Bound to 127.0.0.1 ONLY — it is internal and
# reached solely by the Node API (CONTRACT.md §1).
set -euo pipefail
cd "$(dirname "$0")"
source .venv/bin/activate
exec python -m uvicorn app.main:app --host 127.0.0.1 --port "${ML_PORT:-8000}" "$@"
