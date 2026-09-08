// SSE client for the RAG chat endpoint.
//
// Why fetch + a manual reader instead of EventSource: EventSource cannot send an
// Authorization header (or a POST body), and this endpoint requires the bearer
// token. So we POST and parse the SSE framing ourselves.

import { API_BASE_URL } from "./constants";
import { tokenStore } from "./token-store";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatMeta {
  intent: string;
  mock: boolean;
}

export interface StreamChatHandlers {
  /** Called once, before any text, with the detected intent. */
  onMeta?: (meta: ChatMeta) => void;
  /** Called for every incremental piece of answer text. */
  onChunk: (text: string) => void;
  /** Called with a human-readable reason when the turn fails. */
  onError?: (message: string) => void;
}

/** Signal used to abort an in-flight answer (component unmount, user cancel). */
export type ChatAbort = { abort: () => void };

/**
 * Stream one chat turn.
 *
 * Resolves when the stream is complete. Never throws for an expected failure —
 * `onError` is called with a message worth showing the user, because a generic
 * "something went wrong" is useless when the backend told us exactly what broke.
 */
export async function streamChat(
  message: string,
  history: ChatTurn[],
  handlers: StreamChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = tokenStore.getAccess();
  if (!token) {
    handlers.onError?.("Your session has expired. Please sign in again.");
    return;
  }

  let res: Response;
  try {
    // NOTE: the API lives on a DIFFERENT origin from the Next app (:4000 vs
    // :3000), so this must be the absolute API base. A relative "/api/chat"
    // would hit the Next server, which has no such route, and 404.
    res = await fetch(`${API_BASE_URL}/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, history }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    handlers.onError?.("Could not reach the assistant service.");
    return;
  }

  if (!res.ok) {
    // The backend sends a JSON envelope for pre-stream failures; surface its
    // message rather than inventing one.
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error?.message) detail = body.error.message;
    } catch {
      /* non-JSON body; keep the status-based message */
    }
    handlers.onError?.(detail);
    return;
  }

  if (!res.body) {
    handlers.onError?.("The assistant returned an empty response.");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // SSE frames are separated by a blank line and can be split across network
  // reads, so partial data is held here until its terminator arrives.
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      // Handle both \n\n and \r\n\r\n frame terminators.
      while ((sep = findFrameEnd(buffer)) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^(\r?\n){2}/, "");
        handleFrame(frame, handlers);
      }
    }
    // Flush a trailing frame that arrived without its blank line.
    if (buffer.trim()) handleFrame(buffer, handlers);
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      handlers.onError?.("The answer stream was interrupted.");
    }
  } finally {
    reader.releaseLock();
  }
}

function findFrameEnd(buf: string): number {
  const a = buf.indexOf("\n\n");
  const b = buf.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function handleFrame(frame: string, handlers: StreamChatHandlers): void {
  // A frame may carry several `data:` lines; concatenate per the SSE spec.
  const payloads = frame
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);

  for (const raw of payloads) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue; // keep-alive or comment frame
    }
    if (obj.meta) handlers.onMeta?.(obj.meta as ChatMeta);
    if (typeof obj.chunk === "string") handlers.onChunk(obj.chunk);
    if (typeof obj.error === "string") handlers.onError?.(obj.error);
    // `done` needs no handling: the reader loop ends with the stream.
  }
}
