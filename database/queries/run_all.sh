#!/usr/bin/env bash
# ============================================================================
# run_all.sh — execute every query in the PharmaIQ SQL library and report
#              pass/fail per query. A query PASSES only if it runs without
#              error AND returns at least one row.
#
#   Usage:  ./run_all.sh
#
# Statement splitting is done in Python (BSD awk on macOS does not emit a real
# NUL for \0, which silently breaks a read -d '' loop). None of the library's
# queries contain a ';' inside a string literal, so a naive split on ';' is safe
# here; comment lines are stripped first.
# ============================================================================
set -uo pipefail

export PATH="/opt/homebrew/opt/mysql/bin:$PATH"
SOCK="/opt/homebrew/var/mysql/pharmaiq.sock"
DB="pharmaiq"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STMT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pharmaiq_stmts.XXXXXX")"
trap 'rm -rf "$STMT_DIR"' EXIT

total=0; passed=0; failed=0

for f in "$DIR"/[0-9][0-9]_*.sql; do
    fname="$(basename "$f")"
    echo "──────────────────────────────────────────────────────────────"
    echo "FILE: $fname"

    # Explode this file into one statement per temp file (000, 001, ...).
    rm -f "$STMT_DIR"/*
    python3 - "$f" "$STMT_DIR" <<'PY'
import sys, re, pathlib
src, outdir = sys.argv[1], sys.argv[2]
lines = []
for ln in pathlib.Path(src).read_text().splitlines():
    if re.match(r'^\s*--', ln):        # drop full-line comments
        continue
    lines.append(ln)
text = "\n".join(lines)
stmts = [s.strip() for s in text.split(";") if re.search(r'[A-Za-z]', s)]
for i, s in enumerate(stmts):
    pathlib.Path(outdir, f"{i:03d}.sql").write_text(s + ";\n")
PY

    for sf in "$STMT_DIR"/*.sql; do
        [ -e "$sf" ] || continue
        total=$((total+1))
        label="$(tr '\n' ' ' < "$sf" | sed -E 's/^ *//' | cut -c1-58)"
        out="$(mysql --socket="$SOCK" -u root -D "$DB" --batch --skip-column-names < "$sf" 2>&1)"; rc=$?
        rows="$(printf '%s' "$out" | grep -c .)"
        if [ $rc -ne 0 ]; then
            echo "  ✗ FAIL (error) : ${label}..."
            printf '%s\n' "$out" | head -3 | sed 's/^/        /'
            failed=$((failed+1))
        elif [ "$rows" -eq 0 ]; then
            echo "  ✗ FAIL (0 rows): ${label}..."
            failed=$((failed+1))
        else
            echo "  ✓ PASS (${rows} rows): ${label}..."
            passed=$((passed+1))
        fi
    done
done

echo "──────────────────────────────────────────────────────────────"
echo "SUMMARY: ${total} queries — ${passed} passed, ${failed} failed."
if [ "$failed" -eq 0 ]; then
    echo "ALL QUERIES PASS ✓"
    exit 0
else
    echo "SOME QUERIES FAILED ✗"
    exit 1
fi
