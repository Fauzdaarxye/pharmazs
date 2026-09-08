"""Tests for the RAG chat layer.

Split by what each layer must guarantee:
  * router      — intent classification, including the plural forms real users type
  * scoping     — RBAC predicates, the security-critical part
  * context     — budget ceiling and graceful degradation
  * llm_client  — SSE framing and mock-mode behaviour

The router tests need no database. The scoping and context tests do, and are
skipped when MySQL is not reachable so the suite still runs in CI without one.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from app.rag import llm_client
from app.rag.context_builder import (
    MAX_CONTEXT_CHARS,
    RoleScope,
    _hcp_scope,
    _sales_scope,
    build_context,
)
from app.rag.router import classify


def _db_available() -> bool:
    try:
        from app import db

        db.query_one("SELECT 1 AS x")
        return True
    except Exception:
        return False


needs_db = pytest.mark.skipif(not _db_available(), reason="MySQL not reachable")


# ---------------------------------------------------------------- router ----
@pytest.mark.parametrize(
    "message,expected",
    [
        ("Why did CardioMax drop in North?", "ROOT_CAUSE_QUERY"),
        ("What caused the revenue drop?", "ROOT_CAUSE_QUERY"),
        ("Forecast revenue for next quarter", "FORECAST_QUERY"),
        ("Any anomalies recently?", "ANOMALY_QUERY"),
        ("Which products have stockout risks?", "INVENTORY_QUERY"),
        ("Who are my top priority HCPs?", "HCP_QUERY"),
        ("Show me rep attainment", "REP_QUERY"),
        ("Compare North vs South", "COMPARISON_QUERY"),
        ("Which regions are growing?", "REGION_QUERY"),
        ("Total sales this year", "SALES_QUERY"),
        ("hello there", "GENERAL"),
    ],
)
def test_intent_classification(message: str, expected: str) -> None:
    assert classify(message).intent == expected


@pytest.mark.parametrize(
    "plural,singular",
    [
        ("Who are my top HCPs?", "Who is my top HCP?"),
        ("Which products are growing?", "Which product is growing?"),
        ("Show me my reps", "Show me my rep"),
        ("Any anomalies?", "Any anomaly?"),
        ("Which regions lead?", "Which region leads?"),
    ],
)
def test_plural_and_singular_agree(plural: str, singular: str) -> None:
    """Regression: \\bhcp\\b cannot match "hcps" — \\b fails on the trailing s.

    Plural phrasing is the common case, and when it fell through to GENERAL the
    message reached the LLM with no data context at all.
    """
    assert classify(plural).intent == classify(singular).intent
    assert classify(plural).intent != "GENERAL"


def test_region_and_period_extraction() -> None:
    p = classify("Why did revenue drop in North over the last 2 months?")
    assert p.region_hint == "North"
    assert p.period_months == 2


def test_period_is_capped() -> None:
    """An unbounded window would let one question scan the whole fact table."""
    assert classify("revenue over the last 99 months").period_months == 6


# --------------------------------------------------------------- scoping ----
def test_global_roles_get_no_scope_predicate() -> None:
    for role in ("ADMIN", "EXECUTIVE", "ANALYST"):
        sql, params = _sales_scope(RoleScope(role))
        assert sql == ""
        assert params == []
        assert RoleScope(role).is_global


def test_manager_is_scoped_to_region() -> None:
    sql, params = _sales_scope(RoleScope("MANAGER", region_id=3))
    assert "region_id = %s" in sql
    assert params == [3]


def test_sales_rep_is_scoped_to_rep() -> None:
    sql, params = _sales_scope(RoleScope("SALES_REP", rep_id=11))
    assert "rep_id = %s" in sql
    assert params == [11]


def test_sales_rep_hcp_scope_uses_current_panel_only() -> None:
    """assigned_to IS NULL marks the CURRENT owner.

    Filtering on rep_id alone would also return physicians the rep used to own.
    """
    sql, params = _hcp_scope(RoleScope("SALES_REP", rep_id=11))
    assert "rep_hcp_assignments" in sql
    assert "assigned_to IS NULL" in sql
    assert params == [11]


def test_scope_ids_are_parameterised_not_interpolated() -> None:
    """Scope values must never be formatted into SQL text."""
    sql, params = _sales_scope(RoleScope("MANAGER", region_id=7))
    assert "7" not in sql
    assert params == [7]


def test_missing_scope_id_is_not_silently_widened() -> None:
    """A MANAGER with no region must not fall back to enterprise-wide data."""
    assert RoleScope("MANAGER").is_unscopable
    assert RoleScope("SALES_REP").is_unscopable
    assert not RoleScope("EXECUTIVE").is_unscopable
    assert not RoleScope("MANAGER", region_id=1).is_unscopable


def test_role_scope_accepts_both_key_styles() -> None:
    """The Node API sends camelCase; internal callers use snake_case."""
    a = RoleScope.from_dict({"role": "manager", "regionId": 2})
    b = RoleScope.from_dict({"role": "MANAGER", "region_id": 2})
    assert a.role == b.role == "MANAGER"
    assert a.region_id == b.region_id == 2


def test_role_scope_defaults_are_safe_on_empty_input() -> None:
    s = RoleScope.from_dict(None)
    assert s.region_id is None and s.rep_id is None


@needs_db
def test_unscopable_role_retrieves_nothing() -> None:
    ctx = build_context(classify("Who are my top HCPs?"), {"role": "MANAGER"})
    assert "No data retrieved" in ctx
    assert "|" not in ctx  # no data table was rendered


# --------------------------------------------------------------- context ----
@needs_db
@pytest.mark.parametrize(
    "message",
    [
        "Total sales last 3 months",
        "Who are my top HCPs?",
        "Top products by market share",
        "Which products have stockout risks?",
        "Why did CardioMax drop in North?",
        "Forecast next quarter",
        "Any anomalies?",
        "Which regions lead?",
        "Rep attainment",
        "hello",
    ],
)
def test_every_intent_builds_a_context(message: str) -> None:
    ctx = build_context(classify(message), {"role": "EXECUTIVE"})
    assert ctx.strip()
    assert "Data scope:" in ctx
    assert "retrieval failed" not in ctx
    assert len(ctx) <= MAX_CONTEXT_CHARS + 100


@needs_db
def test_context_declares_the_scope_it_used() -> None:
    """The model is told the scope so it can say the view was restricted."""
    ctx = build_context(classify("Which regions lead?"), {"role": "MANAGER", "regionId": 1})
    assert "MANAGER" in ctx and "region_id=1" in ctx


@needs_db
def test_root_cause_without_a_named_product_explains_itself() -> None:
    ctx = build_context(classify("Why did sales drop?"), {"role": "EXECUTIVE"})
    assert "Cannot run attribution" in ctx
    assert "product name" in ctx


@needs_db
def test_scoped_manager_cannot_probe_another_region() -> None:
    """A denial must say it was denied, not that no region was named."""
    from app import db

    rows = db.query_df("SELECT region_id, region_name FROM regions ORDER BY region_id").to_dict("records")
    mine, other = rows[0], rows[1]
    ctx = build_context(
        classify(f"Why did CardioMax drop in {other['region_name']}?"),
        {"role": "MANAGER", "regionId": int(mine["region_id"])},
    )
    assert "scoped to a single region" in ctx


# ------------------------------------------------------------ llm_client ----
def test_sse_frame_is_single_wrapped_json() -> None:
    """sse-starlette adds `data: ` and the terminator; doing it here too would
    double-wrap the frame and the browser would parse nothing."""
    frame = llm_client.sse_frame({"chunk": "hi"})
    assert not frame.startswith("data:")
    assert not frame.endswith("\n\n")
    assert json.loads(frame) == {"chunk": "hi"}


def test_sse_frame_preserves_unicode() -> None:
    """₹ must survive: every money figure in the context uses it."""
    assert "₹" in llm_client.sse_frame({"chunk": "₹1.5 Cr"})


def test_mock_mode_active_without_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert llm_client.is_mock_mode()


def test_blank_api_key_counts_as_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """An empty or whitespace value must not be treated as a real key."""
    monkeypatch.setenv("GEMINI_API_KEY", "   ")
    assert llm_client.is_mock_mode()


def test_mock_stream_terminates_with_done(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    async def collect() -> list[dict]:
        return [
            json.loads(f)
            async for f in llm_client.stream_gemini_response("q", "ctx: some data", None)
        ]

    frames = asyncio.run(collect())
    assert frames, "stream produced nothing"
    assert frames[-1].get("done") is True
    # The client stops its typing indicator on `done`; without it the UI hangs.
    assert any("chunk" in f for f in frames)


def test_mock_stream_echoes_the_retrieved_context(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mock mode must still prove retrieval ran, or it hides pipeline breakage."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    async def collect() -> str:
        parts = [
            json.loads(f).get("chunk", "")
            async for f in llm_client.stream_gemini_response("q", "SENTINEL_VALUE_42", None)
        ]
        return "".join(parts)

    assert "SENTINEL_VALUE_42" in asyncio.run(collect())
