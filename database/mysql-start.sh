#!/usr/bin/env bash
# Start PharmaZs's own MySQL instance.
#
# WHY A SEPARATE INSTANCE: this machine already runs an unrelated MySQL 9.7
# system daemon (installed under /usr/local/mysql, LaunchDaemon
# com.oracle.oss.mysql.mysqld) on the default port 3306, owning /tmp/mysql.sock,
# with a root password we do not have. We must not touch it. PharmaZs therefore
# runs a Homebrew mysqld on port 3307 with its OWN socket, so the two never
# collide and nothing we do can affect the pre-existing server.
#
# Usage:  database/mysql-start.sh [--status|--stop]

set -euo pipefail

MYSQL_HOME=/opt/homebrew/opt/mysql
DATADIR=/opt/homebrew/var/mysql
SOCKET="$DATADIR/pharmazs.sock"
PORT=3307
ERRLOG="$DATADIR/pharmazs.err"
PIDFILE="$DATADIR/pharmazs.pid"
export PATH="$MYSQL_HOME/bin:$PATH"

is_up() { mysqladmin --socket="$SOCKET" -u root ping >/dev/null 2>&1 && \
          mysql --socket="$SOCKET" -u root -e 'SELECT 1' >/dev/null 2>&1; }

case "${1:-start}" in
  --status)
    if is_up; then
      mysql --socket="$SOCKET" -u root -e "SELECT VERSION() AS version, @@port AS port;"
      echo "PharmaZs MySQL is UP on port $PORT"
    else
      echo "PharmaZs MySQL is DOWN"; exit 1
    fi
    ;;
  --stop)
    if [ -f "$PIDFILE" ]; then
      kill "$(cat "$PIDFILE")" 2>/dev/null || true
      echo "stop signalled"
    else
      mysqladmin --socket="$SOCKET" -u root shutdown 2>/dev/null || echo "not running"
    fi
    ;;
  start)
    if is_up; then echo "already up on port $PORT"; exit 0; fi

    # First run: initialise the data directory.
    if [ ! -d "$DATADIR/mysql" ]; then
      echo "initialising datadir at $DATADIR ..."
      mysqld --initialize-insecure --user="$(id -un)" \
             --basedir="$MYSQL_HOME" --datadir="$DATADIR" 2>&1 | tail -3
    fi

    # setsid detaches mysqld from this shell's process group, so it survives the
    # shell exiting. A plain `nohup ... &` was NOT enough here — the server died
    # whenever the launching agent shell was reclaimed.
    echo "starting mysqld on port $PORT ..."
    setsid mysqld --user="$(id -un)" --basedir="$MYSQL_HOME" --datadir="$DATADIR" \
      --port="$PORT" --socket="$SOCKET" --mysqlx=OFF \
      --log-error="$ERRLOG" --pid-file="$PIDFILE" \
      --local-infile=ON \
      > /dev/null 2>&1 < /dev/null &
    disown || true

    for _ in $(seq 1 40); do is_up && { echo "UP on port $PORT"; exit 0; }; sleep 1; done
    echo "FAILED to start; last lines of $ERRLOG:"; tail -20 "$ERRLOG"; exit 1
    ;;
  *)
    echo "usage: $0 [start|--status|--stop]"; exit 2
    ;;
esac
