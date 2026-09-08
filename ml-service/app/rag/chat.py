"""Chat orchestrator — classify, retrieve, then stream.

Deliberately thin: the three steps live in their own modules so each is testable
alone (the router with no database, the context builder with no model, the LLM
client with no HTTP layer). This module only wires them together.
"""
from __future__ import annotations

import logging
from collections.abc import AsyncGenerator

from . import context_builder, llm_client, router

logger = logging.getLogger(__name__)


async def stream_chat(
    message: str,
    history: list[dict] | None = None,
    role_scope: dict | None = None,
) -> AsyncGenerator[str, None]:
    """Run the full RAG turn and yield SSE JSON payloads.

    Retrieval happens BEFORE the model is contacted and its failures are folded
    into the context rather than raised, so a data problem produces an answer
    that explains itself instead of a dead stream.
    """
    parsed = router.classify(message)
    context = context_builder.build_context(parsed, role_scope)

    logger.info(
        "chat turn: intent=%s role=%s context_chars=%d mock=%s",
        parsed.intent,
        (role_scope or {}).get("role"),
        len(context),
        llm_client.is_mock_mode(),
    )

    # Tell the client what was detected before tokens arrive, so the UI can show
    # the intent immediately and a developer can see why a given answer was
    # grounded the way it was.
    yield llm_client.sse_frame({"meta": {"intent": parsed.intent, "mock": llm_client.is_mock_mode()}})

    async for frame in llm_client.stream_gemini_response(message, context, history):
        yield frame
