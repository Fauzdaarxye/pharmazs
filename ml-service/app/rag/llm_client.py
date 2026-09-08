"""Gemini client — streams an answer grounded in the retrieved context.

The model is given ONE job: narrate the verified context it is handed. It has no
tools, no database access and no browsing, so anything it states that is not in
the context is a fabrication — which is why the system prompt forbids it
explicitly and why we say so in the UI.

MOCK MODE
---------
With no GEMINI_API_KEY the module streams a deterministic answer assembled from
the context instead of failing. That keeps the whole pipeline — SSE framing,
the Node proxy, the React reader — testable without a paid key, and makes it
obvious in the transcript that no model ran.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import AsyncGenerator

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load .env HERE rather than relying on another module having done it.
# GEMINI_API_KEY was previously only visible because `db` happened to be
# imported first (it calls load_dotenv at import time). Any importer that did
# not touch `db` silently fell back to mock mode with a perfectly good key
# sitting in .env. load_dotenv is idempotent and does not override real
# environment variables, so calling it again is free and safe.
load_dotenv()

# Overridable because model names get RETIRED. gemini-2.0-flash — the name this
# was originally built against — now returns:
#   404 NOT_FOUND "This model models/gemini-2.0-flash is no longer available.
#   Please update your code to use models/gemini-3.6-flash"
# Pinning it in code alone means the next retirement is a code change; reading an
# env var first means it is a config change.
MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")

SYSTEM_PROMPT = """You are the PharmaZs AI Commercial Intelligence Assistant.

Answer using ONLY the verified database context provided below. That context was
retrieved live from the PharmaZs MySQL database for this specific question, and
it has already been filtered to what this user is permitted to see.

Rules you must follow:
- Use ONLY the numbers in the context. Never estimate, extrapolate or recall a
  figure from memory. If the context does not contain what was asked, say so
  plainly and name what you would need — do not guess.
- Format money in Indian numbering: ₹ Cr and ₹ Lakh. The context already uses
  these units, so carry them through rather than reconverting.
- State that your answer is based on live MySQL records.
- Be concise and lead with the direct answer. Use short markdown: a couple of
  bullets or a small table, bold for key figures.
- When the context reports a scope restriction, respect it and mention that the
  view is limited to the user's own region or panel.
- Never invent an HCP, product, region or rep name that is not in the context.
"""


def _api_key() -> str | None:
    key = os.getenv("GEMINI_API_KEY")
    return key.strip() if key and key.strip() else None


def is_mock_mode() -> bool:
    return _api_key() is None


def sse_frame(payload: dict) -> str:
    """One SSE data frame.

    sse-starlette adds the `data: ` prefix and the blank-line terminator itself,
    so this returns the JSON body only. Emitting `data: ...\\n\\n` here would
    double-wrap it and the browser would parse nothing.
    """
    return json.dumps(payload, ensure_ascii=False)


def _build_prompt(message: str, context: str, history: list[dict] | None) -> str:
    parts: list[str] = [SYSTEM_PROMPT, "", "=== VERIFIED DATABASE CONTEXT ===", context, ""]
    if history:
        # Keep only the last few turns: the context is the expensive part of the
        # prompt and old turns add little once the data has changed.
        recent = history[-6:]
        parts.append("=== CONVERSATION SO FAR ===")
        for turn in recent:
            role = str(turn.get("role", "user")).lower()
            speaker = "User" if role == "user" else "Assistant"
            parts.append(f"{speaker}: {turn.get('content', '')}")
        parts.append("")
    parts.append("=== CURRENT QUESTION ===")
    parts.append(message)
    return "\n".join(parts)


async def _stream_mock(message: str, context: str) -> AsyncGenerator[str, None]:
    """Deterministic stand-in that echoes the retrieved data."""
    lines = [
        "**Mock mode — no GEMINI_API_KEY is configured, so no language model ran.**",
        "",
        "The retrieval layer did run, and this is the verified data it pulled "
        "from live MySQL for your question:",
        "",
        context.strip(),
        "",
        "_Set GEMINI_API_KEY in the ML service environment to get a narrated answer._",
    ]
    for line in lines:
        # Chunk in small groups rather than per word. Per-word framing produced
        # ~300 frames for one answer, which is not representative of Gemini's
        # chunking and made the client do far more work than production would.
        words = line.split(" ") if line else [""]
        for start in range(0, len(words), 5):
            yield sse_frame({"chunk": " ".join(words[start:start + 5]) + " "})
            await asyncio.sleep(0.01)
        yield sse_frame({"chunk": "\n"})


async def stream_gemini_response(
    prompt: str,
    context: str,
    history: list[dict] | None = None,
) -> AsyncGenerator[str, None]:
    """Yield SSE JSON payloads for the answer to `prompt`.

    Always terminates with a `{"done": true}` frame so the client can stop its
    typing indicator deterministically instead of guessing from silence.
    """
    key = _api_key()
    if key is None:
        logger.warning("GEMINI_API_KEY not set — serving mock chat response")
        async for frame in _stream_mock(prompt, context):
            yield frame
        yield sse_frame({"done": True, "mock": True})
        return

    full_prompt = _build_prompt(prompt, context, history)

    try:
        from google import genai

        client = genai.Client(api_key=key)
        # generate_content_stream is synchronous and blocking, so it is pushed to
        # a worker thread and drained through a queue. Iterating it directly on
        # the event loop would stall every other request for the whole
        # generation, which for a streaming endpoint defeats the point.
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()
        SENTINEL = object()

        def _produce() -> None:
            try:
                stream = client.models.generate_content_stream(
                    model=MODEL_NAME,
                    contents=full_prompt,
                )
                for event in stream:
                    text = getattr(event, "text", None)
                    if text:
                        loop.call_soon_threadsafe(queue.put_nowait, text)
            except Exception as exc:  # noqa: BLE001 - reported to the client below
                loop.call_soon_threadsafe(queue.put_nowait, exc)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, SENTINEL)

        task = loop.run_in_executor(None, _produce)

        while True:
            item = await queue.get()
            if item is SENTINEL:
                break
            if isinstance(item, Exception):
                logger.error("Gemini streaming failed: %s", item)
                # Surface the provider's OWN message, not just the class name.
                # "ClientError" sent me to the server log to discover the model
                # had been retired — exactly the generic-error trap this project
                # avoids elsewhere. Provider errors carry the actionable detail
                # (model retired, quota exhausted, key rejected) and none of them
                # echo the API key back.
                detail = str(item).strip() or type(item).__name__
                if len(detail) > 400:
                    detail = detail[:400] + "…"
                yield sse_frame({
                    "error": f"The language model call failed ({type(item).__name__}): "
                             f"{detail} — the database context was retrieved successfully."
                })
                break
            yield sse_frame({"chunk": item})

        await task
        yield sse_frame({"done": True})

    except Exception as exc:  # noqa: BLE001 - client must not hang on a crash
        logger.exception("Chat streaming aborted")
        yield sse_frame({"error": f"Chat failed: {type(exc).__name__}: {exc}"})
        yield sse_frame({"done": True})
