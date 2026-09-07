#!/usr/bin/env python3
"""
Detach a long-running process from the calling shell — portably.

WHY THIS EXISTS
---------------
Services started from an automation/agent shell on this machine were dying a few
minutes later with "Received SHUTDOWN from user <via user signal>". The cause is
that the whole process group gets SIGTERM'd when the launching shell is reclaimed,
and the two usual reflexes do not help:

  * `nohup` only ignores SIGHUP, not the SIGTERM actually being delivered.
  * `setsid` DOES fix it — but macOS ships no `setsid` binary, so the command
    silently failed with "command not found" while the surrounding `... &` made
    the failure invisible.

So we do the detach ourselves: fork, `os.setsid()` to become a new session leader
(escaping the caller's process group entirely), fork again so the daemon can never
reacquire a controlling terminal, then exec the real command.

USAGE
    daemon.py start  <name> --cwd <dir> -- <command> [args...]
    daemon.py status <name>
    daemon.py stop   <name>

State lives in <repo>/.run/<name>.{pid,log}.
"""

from __future__ import annotations

import argparse
import os
import signal
import sys
import time
from pathlib import Path

RUN_DIR = Path(__file__).resolve().parent.parent / ".run"


def _paths(name: str) -> tuple[Path, Path]:
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    return RUN_DIR / f"{name}.pid", RUN_DIR / f"{name}.log"


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError) as exc:
        return isinstance(exc, PermissionError)   # exists but owned elsewhere
    return True


def _read_pid(name: str) -> int | None:
    pidfile, _ = _paths(name)
    if not pidfile.exists():
        return None
    try:
        pid = int(pidfile.read_text().strip())
    except ValueError:
        return None
    return pid if _alive(pid) else None


def start(name: str, cwd: str | None, cmd: list[str]) -> int:
    existing = _read_pid(name)
    if existing:
        print(f"{name}: already running (pid {existing})")
        return 0
    if not cmd:
        print("no command given", file=sys.stderr)
        return 2

    pidfile, logfile = _paths(name)

    # First fork: the caller returns immediately and never waits on the daemon.
    if os.fork() > 0:
        for _ in range(100):                      # give the child time to record its pid
            time.sleep(0.05)
            pid = _read_pid(name)
            if pid:
                print(f"{name}: started (pid {pid}), logging to {logfile}")
                return 0
        print(f"{name}: started but no pid recorded — check {logfile}", file=sys.stderr)
        return 1

    # --- child ---------------------------------------------------------------
    os.setsid()                                   # new session: leaves the caller's group
    if os.fork() > 0:                             # second fork: never a session leader again
        os._exit(0)

    # --- grandchild: the actual daemon --------------------------------------
    os.chdir(cwd or ".")
    with open(os.devnull, "rb", 0) as devnull, open(logfile, "ab", 0) as log:
        os.dup2(devnull.fileno(), 0)
        os.dup2(log.fileno(), 1)
        os.dup2(log.fileno(), 2)
    pidfile.write_text(str(os.getpid()))
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    try:
        os.execvp(cmd[0], cmd)
    except OSError as exc:                        # exec failed: leave a readable reason
        sys.stderr.write(f"exec failed for {cmd!r}: {exc}\n")
        os._exit(127)


def status(name: str) -> int:
    pid = _read_pid(name)
    print(f"{name}: {'RUNNING (pid %d)' % pid if pid else 'STOPPED'}")
    return 0 if pid else 1


def stop(name: str) -> int:
    pid = _read_pid(name)
    if not pid:
        print(f"{name}: not running")
        return 0
    # SIGTERM the whole session so child processes (npm -> next, uvicorn workers)
    # go down with the parent instead of being orphaned.
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for _ in range(60):
        if not _alive(pid):
            break
        time.sleep(0.25)
    else:
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except Exception:
            pass
    _paths(name)[0].unlink(missing_ok=True)
    print(f"{name}: stopped")
    return 0


def main() -> int:
    # Split on the first `--` OURSELVES rather than using argparse.REMAINDER.
    # REMAINDER attaches to a positional and greedily swallows everything after
    # `name` — including `--cwd <dir>` — so the daemon ended up trying to exec
    # "--cwd" as a binary and every service failed with ENOENT.
    argv = sys.argv[1:]
    if "--" in argv:
        split = argv.index("--")
        head, cmd = argv[:split], argv[split + 1:]
    else:
        head, cmd = argv, []

    ap = argparse.ArgumentParser(description="Detach a service from the calling shell")
    ap.add_argument("action", choices=["start", "status", "stop"])
    ap.add_argument("name")
    ap.add_argument("--cwd")
    args = ap.parse_args(head)

    if args.action == "start":
        return start(args.name, args.cwd, cmd)
    if args.action == "status":
        return status(args.name)
    return stop(args.name)


if __name__ == "__main__":
    sys.exit(main())
