#!/usr/bin/env python3
"""
Capture PharmaIQ pages for visual review / regression.

    scripts/screenshot.py                       # all default pages
    scripts/screenshot.py /dashboard /hcps      # specific routes
    scripts/screenshot.py --out /tmp/shots

Logs in through the real login FORM (not by injecting a token), so a run also
proves the auth flow works end to end.

NOTE ON --no-sandbox: playwright-cli could not launch the bundled
chrome-headless-shell in this environment ("Target crashed"), while the very same
binary ran fine when invoked directly with --no-sandbox. The Chromium sandbox
cannot initialise under the automation process's restrictions, so we launch with
it disabled. That is acceptable here because we only ever point this at our own
loopback dev server — do not reuse this flag to browse untrusted pages.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

DEFAULT_PAGES = ["/login", "/dashboard", "/hcps"]
BASE = "http://127.0.0.1:3000"
EMAIL, PASSWORD = "exec@pharmaiq.io", "PharmaIQ@2026"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pages", nargs="*", default=None)
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / ".run" / "shots"))
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=1200)
    args = ap.parse_args()
    pages = args.pages or DEFAULT_PAGES

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed. Run:\n"
              "  python3 -m venv .run/pwvenv && .run/pwvenv/bin/pip install playwright\n"
              "  .run/pwvenv/bin/playwright install chromium", file=sys.stderr)
        return 2

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        ctx = browser.new_context(viewport={"width": args.width, "height": args.height},
                                  device_scale_factor=1)
        page = ctx.new_page()
        errors: list[str] = []
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
                if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        # --- login page first (unauthenticated) -----------------------------
        page.goto(f"{args.base}/login", wait_until="networkidle")
        shot = outdir / "login.png"
        page.screenshot(path=str(shot), full_page=True)
        written.append(shot)
        print(f"captured {shot.name}")

        # --- authenticate through the form ----------------------------------
        try:
            page.fill('input[type="email"], input[name="email"]', EMAIL)
            page.fill('input[type="password"], input[name="password"]', PASSWORD)
            page.click('button[type="submit"]')
            page.wait_for_url("**/dashboard", timeout=20_000)
            page.wait_for_load_state("networkidle")
            print("login OK -> /dashboard")
        except Exception as exc:                      # noqa: BLE001
            print(f"LOGIN FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
            for e in errors[:15]:
                print("  " + e, file=sys.stderr)
            browser.close()
            return 1

        for route in pages:
            if route == "/login":
                continue
            page.goto(f"{args.base}{route}", wait_until="networkidle")
            page.wait_for_timeout(1200)               # let charts finish animating
            name = route.strip("/").replace("/", "_") or "root"
            shot = outdir / f"{name}.png"
            page.screenshot(path=str(shot), full_page=True)
            written.append(shot)
            print(f"captured {shot.name}")

        browser.close()

    if errors:
        print(f"\n{len(errors)} console/page issue(s):")
        for e in dict.fromkeys(errors):               # dedupe, keep order
            print("  " + e)
    else:
        print("\nno console errors or warnings")

    print("\nwrote:")
    for w in written:
        print(f"  {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
