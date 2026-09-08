#!/usr/bin/env bash
# PharmaZs dev stack — start / stop / status every service in dependency order.
#
#   scripts/dev.sh up       start MySQL, ML service, API, frontend
#   scripts/dev.sh down     stop everything
#   scripts/dev.sh status   report each service
#   scripts/dev.sh logs <mysql|ml|api|web>
#
# Services are detached via scripts/daemon.py rather than `nohup ... &`, because
# on this host the launching shell's process group gets SIGTERM'd and takes any
# plain background job with it. See the docstring in daemon.py.

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DAEMON="$ROOT/scripts/daemon.py"
RUN="$ROOT/.run"
export PATH="/opt/homebrew/opt/mysql/bin:$PATH"
SOCKET=/opt/homebrew/var/mysql/pharmazs.sock
# Stable temp dir for mysqld's on-disk sorts — never inherit TMPDIR (see `up`).
MYSQL_TMPDIR=/opt/homebrew/var/mysql/tmp

mysql_up()  { mysql --socket="$SOCKET" -u root -e 'SELECT 1' >/dev/null 2>&1; }
http_ok()   { curl -s -o /dev/null --max-time 3 "$1"; }

wait_for() {  # wait_for <label> <test-cmd> <seconds>
  local label="$1" cmd="$2" secs="${3:-40}"
  for _ in $(seq 1 "$secs"); do
    if eval "$cmd" >/dev/null 2>&1; then echo "  $label ready"; return 0; fi
    sleep 1
  done
  echo "  $label DID NOT COME UP — see $RUN/"; return 1
}

case "${1:-status}" in
up)
  mkdir -p "$RUN"
  echo "1/4 MySQL (isolated instance, port 3307)"
  if mysql_up; then echo "  already up"; else
    # --tmpdir is pinned deliberately. Without it mysqld inherits TMPDIR from the
    # launching shell, and an agent shell's TMPDIR is a PER-SESSION scratch dir
    # that gets reclaimed while this long-lived server keeps pointing at it. The
    # result is delayed and confusing: the server stays up and simple queries
    # work, but anything that spills to an on-disk temp table (large sorts,
    # GROUP BYs — i.e. the analytics queries) fails with
    # "Can't create/write to file ... (OS errno 2)".
    mkdir -p "$MYSQL_TMPDIR"
    python3 "$DAEMON" start mysql --cwd "$ROOT" -- \
      mysqld --user="$(id -un)" \
        --basedir=/opt/homebrew/opt/mysql --datadir=/opt/homebrew/var/mysql \
        --port=3307 --socket="$SOCKET" --mysqlx=OFF --local-infile=ON \
        --tmpdir="$MYSQL_TMPDIR" \
        --log-error=/opt/homebrew/var/mysql/pharmazs.err
    wait_for MySQL mysql_up 40
  fi

  echo "2/4 ML service (FastAPI, 127.0.0.1:8000)"
  python3 "$DAEMON" start ml --cwd "$ROOT/ml-service" -- \
    "$ROOT/ml-service/.venv/bin/python" -m uvicorn app.main:app \
      --host 127.0.0.1 --port 8000
  wait_for "ML service" "http_ok http://127.0.0.1:8000/health" 40

  echo "3/4 API (Express, 127.0.0.1:4000)"
  python3 "$DAEMON" start api --cwd "$ROOT/backend" -- npm run start
  wait_for API "http_ok http://127.0.0.1:4000/api/health" 40

  echo "4/4 Frontend (Next.js, 127.0.0.1:3000)"
  python3 "$DAEMON" start web --cwd "$ROOT/frontend" -- npm run dev
  wait_for Frontend "http_ok http://127.0.0.1:3000/login" 90

  echo
  echo "Stack up:  http://127.0.0.1:3000/login"
  echo "Demo login: exec@pharmazs.io / PharmaZs@2026"
  ;;

down)
  for s in web api ml mysql; do python3 "$DAEMON" stop "$s"; done
  ;;

status)
  for s in mysql ml api web; do python3 "$DAEMON" status "$s"; done
  echo "--- reachability ---"
  mysql_up && echo "  mysql  :3307 OK" || echo "  mysql  :3307 unreachable"
  for probe in "ml :8000 http://127.0.0.1:8000/health" \
               "api :4000 http://127.0.0.1:4000/api/health" \
               "web :3000 http://127.0.0.1:3000/login"; do
    set -- $probe
    if http_ok "$3"; then echo "  $1 $2 OK"; else echo "  $1 $2 unreachable"; fi
  done
  ;;

logs)
  tail -40 "$RUN/${2:-api}.log"
  ;;

*)
  echo "usage: $0 [up|down|status|logs <mysql|ml|api|web>]"; exit 2 ;;
esac
