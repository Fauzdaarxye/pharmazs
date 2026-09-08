"""Intent router — classifies a user message into a query category.

No LLM is used here: keyword/pattern matching is fast, free, and predictable.
The router identifies entities (drug names, region names) from the message too,
so the context builder can scope its SQL without another model call.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
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
_INTENT_PATTERNS: list[tuple[Intent, list[str]]] = [
    ("ROOT_CAUSE_QUERY", [
        r"\bwhy\b.*(sale|revenue|drop|decline|fell|fall|decrease|down)",
        r"\broot.?cause\b",
        r"\bwhat.*(caused|cause|reason|explain).*drop",
        r"\bwhy.*performing\b",
    ]),
    ("FORECAST_QUERY", [
        r"\bforecast\b",
        r"\bpredict\b",
        r"\bnext\s+(quarter|month|year)\b",
        r"\bprojection\b",
        r"\bwhat.*will.*revenue\b",
        r"\bexpected.*revenue\b",
    ]),
    ("ANOMALY_QUERY", [
        r"\banomaly\b|\banomalies\b",
        r"\bunusual\b",
        r"\boutlier\b",
        r"\balert\b|\balerts\b",
        r"\babnormal\b",
        r"\bspike\b|\bdrop alert\b",
    ]),
    ("INVENTORY_QUERY", [
        r"\binventory\b",
        r"\bstock\b",
        r"\bstockout\b",
        r"\bsupply\b",
        r"\bshortage\b",
        r"\bat.?risk\b.*product",
    ]),
    ("HCP_QUERY", [
        r"\bhcp\b",
        r"\bdoctor\b|\bphysician\b",
        r"\bcardiologist\b|\bdiabetologist\b|\boncologist\b",
        r"\bspecialist\b",
        r"\bprescri\w+",
        r"\bpanel\b",
        r"\bpotential score\b|\bscore\b.*hcp",
    ]),
    ("REP_QUERY", [
        r"\brep\b|\bsales rep\b|\brepresentative\b",
        r"\bfield\s+rep\b",
        r"\battainment\b",
        r"\btarget\b.*achieved",
        r"\bquota\b",
    ]),
    ("FORECAST_QUERY", [
        r"\bgrowth\s+trend\b",
        r"\btrend\b",
    ]),
    ("COMPARISON_QUERY", [
        r"\bcompare\b",
        r"\bvs\b|\bversus\b",
        r"\bdifference\s+between\b",
        r"\bbetter.*than\b|\bworse.*than\b",
    ]),
    ("REGION_QUERY", [
        r"\bregion\b|\bzone\b|\bterritory\b",
        r"\bnorth\s+region\b|\bsouth\s+region\b|\beast\s+region\b|\bwest\s+region\b|\bcentral\s+region\b",
        r"\bgeograph\b",
    ]),
    ("PRODUCT_QUERY", [
        r"\bproduct\b|\bdrug\b|\bbrand\b",
        r"\bmarket share\b",
        r"\btop.*(product|drug|brand)\b",
        r"\bcompetitor\b",
    ]),
    ("SALES_QUERY", [
        r"\bsale\b|\bsales\b|\brevenue\b",
        r"\bperformance\b",
        r"\bearned\b|\bgenerated\b",
        r"\bhow much\b",
        r"\btotal\b.*(revenue|sale)",
    ]),
]


@dataclass
class ParsedQuery:
    intent: Intent
    raw: str
    drug_hint: str | None = None          # drug name fragment found in text
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
