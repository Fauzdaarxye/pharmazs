"""Intent router — classifies a user message into a query category.

No LLM is used here: keyword/pattern matching is fast, free, and predictable.
The router identifies entities (drug names, region names) from the message too,
so the context builder can scope its SQL without another model call.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Intent = Literal[
    "SALES_QUERY",
    "PRODUCT_QUERY",
    "HCP_QUERY",
    "REGION_QUERY",
    "INVENTORY_QUERY",
    "ROOT_CAUSE_QUERY",
    "FORECAST_QUERY",
    "ANOMALY_QUERY",
    "COMPARISON_QUERY",
    "REP_QUERY",
    "GENERAL",
]

# Known dimension values — used for entity extraction from free text.
# Kept lowercase for case-insensitive matching.
_REGIONS = {"north", "south", "east", "west", "central"}
_TA_KEYWORDS = {
    "cardiology", "cardiac", "heart",
    "diabetes", "diabetic",
    "oncology", "cancer",
    "respiratory", "resp",
    "neurology", "neuro",
    "gastroenterology", "gastro",
}

# Intent pattern groups: tuples of (intent, list-of-regex-patterns).
# First match wins.
#
# NOTE ON PLURALS: every noun here carries an explicit `s?`. A bare r"\bhcp\b"
# does NOT match "hcps" — \b fails against the trailing "s" — and plural
# phrasing is how users actually ask ("who are my top HCPs", "which products").
# Without this, such messages fell through to GENERAL and reached the LLM with
# no data context at all, which is exactly what the system prompt forbids.
_INTENT_PATTERNS: list[tuple[Intent, list[str]]] = [
    ("ROOT_CAUSE_QUERY", [
        r"\bwhy\b.*(sale|revenue|drop|decline|fell|fall|decrease|down)",
        r"\broot.?cause\b",
        r"\bwhat.*(caused|cause|reason|explain).*drop",
        r"\bwhy.*performing\b",
    ]),
    ("FORECAST_QUERY", [
        r"\bforecasts?\b",
        r"\bpredicts?\b|\bpredicted\b|\bprediction\b",
        r"\bnext\s+(quarter|month|year)\b",
        r"\bprojections?\b",
        r"\bwhat.*will.*revenue\b",
        r"\bexpected.*revenue\b",
    ]),
    ("ANOMALY_QUERY", [
        r"\banomaly\b|\banomalies\b",
        r"\bunusual\b",
        r"\boutliers?\b",
        r"\balerts?\b",
        r"\babnormal\b",
        r"\bspikes?\b",
    ]),
    ("INVENTORY_QUERY", [
        r"\binventor(y|ies)\b",
        r"\bstocks?\b",
        r"\bstockouts?\b",
        r"\bsupply\b|\bsupplies\b",
        r"\bshortages?\b",
        r"\bat.?risk\b",
    ]),
    ("HCP_QUERY", [
        r"\bhcps?\b",
        r"\bdoctors?\b|\bphysicians?\b",
        r"\bcardiologists?\b|\bdiabetologists?\b|\boncologists?\b",
        r"\bspecialists?\b",
        r"\bprescri\w+",
        r"\bpanels?\b",
        r"\bpotential scores?\b|\bscores?\b",
    ]),
    ("REP_QUERY", [
        r"\breps?\b|\bsales reps?\b|\brepresentatives?\b",
        r"\bfield\s+reps?\b",
        r"\battainment\b",
        r"\btargets?\b.*achieved",
        r"\bquotas?\b",
    ]),
    ("FORECAST_QUERY", [
        r"\bgrowth\s+trends?\b",
        r"\btrends?\b",
    ]),
    ("COMPARISON_QUERY", [
        r"\bcompare\b|\bcomparison\b",
        r"\bvs\b|\bversus\b",
        r"\bdifference\s+between\b",
        r"\bbetter.*than\b|\bworse.*than\b",
    ]),
    ("REGION_QUERY", [
        r"\bregions?\b|\bzones?\b|\bterritor(y|ies)\b",
        r"\bgeograph\w*",
    ]),
    ("PRODUCT_QUERY", [
        r"\bproducts?\b|\bdrugs?\b|\bbrands?\b",
        r"\bmarket shares?\b",
        r"\bcompetitors?\b",
    ]),
    ("SALES_QUERY", [
        r"\bsales?\b|\brevenues?\b",
        r"\bperformance\b",
        r"\bearned\b|\bgenerated\b",
        r"\bhow much\b",
        r"\btotal\b.*(revenue|sale)",
    ]),
]


@dataclass
class ParsedQuery:
    """Result of intent classification.

    Deliberately carries NO drug hint: resolving "CardioMax" to a drug_id needs
    the database, and this module is kept DB-free so it stays fast and unit
    testable. `context_builder` resolves drug names off `raw` against the drugs
    table, which also means a renamed or newly added product needs no change
    here.
    """
    intent: Intent
    raw: str
    region_hint: str | None = None        # region name found in text
    ta_hint: str | None = None            # therapeutic area keyword found
    period_months: int = 3                # default comparison window


def classify(message: str) -> ParsedQuery:
    """Classify message intent and extract entity hints."""
    lowered = message.lower()

    # --- entity extraction ---
    region_hint: str | None = None
    for r in _REGIONS:
        if re.search(rf"\b{r}\b", lowered):
            region_hint = r.capitalize()
            break

    ta_hint: str | None = None
    for kw in _TA_KEYWORDS:
        if kw in lowered:
            ta_hint = kw
            break

    # period hint: look for "last N months", "past N months", etc.
    period_months = 3
    pm = re.search(r"\blast?\s+(\d+)\s+month", lowered)
    if pm:
        period_months = min(int(pm.group(1)), 6)

    # --- intent classification ---
    intent: Intent = "GENERAL"
    for candidate_intent, patterns in _INTENT_PATTERNS:
        for pat in patterns:
            if re.search(pat, lowered):
                intent = candidate_intent
                break
        if intent != "GENERAL":
            break

    return ParsedQuery(
        intent=intent,
        raw=message,
        region_hint=region_hint,
        ta_hint=ta_hint,
        period_months=period_months,
    )
