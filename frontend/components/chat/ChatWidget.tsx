"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Sparkles, X, Send, AlertTriangle } from "lucide-react";
import { streamChat, type ChatTurn } from "@/lib/chat-stream";
import { tokenStore } from "@/lib/token-store";
import { Markdown } from "./Markdown";

/**
 * Floating RAG chat assistant, mounted once by AppShell so it is available on
 * every authenticated page.
 *
 * Answers are grounded in data retrieved live from MySQL and scoped to the
 * caller's role by the API, so what a SALES_REP sees here is the same slice they
 * see everywhere else in the product.
 */

const SUGGESTIONS = [
  "Why did CardioMax drop in North?",
  "Who are my top priority HCPs?",
  "Which products have stockout risks?",
];

/** Explicit UI states — a single boolean cannot express "streaming vs failed". */
type Phase = "idle" | "streaming" | "error";

interface Message {
  role: "user" | "assistant";
  content: string;
  /** Set on an assistant message that ended in failure. */
  failed?: boolean;
  intent?: string;
  mock?: boolean;
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Incoming tokens are buffered and flushed on a timer rather than applied one
  // per setState. Gemini (and mock mode) emit many small chunks, and a state
  // update per chunk re-renders the transcript hundreds of times a second —
  // enough to crash the renderer on a long answer. ~20 flushes/sec still reads
  // as continuous typing.
  const pendingRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const role = tokenStore.getUser()?.role ?? null;

  const FLUSH_MS = 50;

  /** Append everything buffered so far to the in-progress assistant message. */
  function flushPending() {
    flushTimerRef.current = null;
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = "";
    setMessages((prev) => {
      const next = [...prev];
      const last = next.length - 1;
      if (last < 0 || next[last].role !== "assistant") return prev;
      next[last] = { ...next[last], content: next[last].content + pending };
      return next;
    });
  }

  // Follow the answer as it streams.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, phase]);

  // Abandon an in-flight answer if the widget unmounts mid-stream, so the
  // backend stops generating and no state update lands on a dead component.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    },
    [],
  );

  const streaming = phase === "streaming";

  async function send(text: string) {
    const message = text.trim();
    // Guarding here as well as on the button matters: Enter bypasses `disabled`.
    if (!message || streaming) return;

    setError(null);
    setInput("");

    // History sent upstream is the conversation BEFORE this turn.
    const history: ChatTurn[] = messages
      .filter((m) => !m.failed)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [
      ...prev,
      { role: "user", content: message },
      { role: "assistant", content: "" },
    ]);
    setPhase("streaming");

    const controller = new AbortController();
    abortRef.current = controller;

    let failed = false;

    await streamChat(
      message,
      history,
      {
        onMeta: (meta) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next.length - 1;
            next[last] = { ...next[last], intent: meta.intent, mock: meta.mock };
            return next;
          });
        },
        onChunk: (chunk) => {
          // Buffer, then flush on a timer — see pendingRef above.
          pendingRef.current += chunk;
          if (flushTimerRef.current === null) {
            flushTimerRef.current = setTimeout(flushPending, FLUSH_MS);
          }
        },
        onError: (msg) => {
          // Show the backend's actual reason — never a generic failure string.
          failed = true;
          setError(msg);
          setMessages((prev) => {
            const next = [...prev];
            const last = next.length - 1;
            next[last] = { ...next[last], failed: true };
            return next;
          });
        },
      },
      controller.signal,
    );

    abortRef.current = null;

    // Drain anything still buffered before declaring the turn finished, or the
    // last few tokens of every answer would be silently dropped.
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    flushPending();

    setPhase(failed ? "error" : "idle");

    // An answer that produced no text at all is a failure the user must see,
    // not an empty bubble.
    setMessages((prev) => {
      const next = [...prev];
      const last = next.length - 1;
      if (next[last]?.role === "assistant" && !next[last].content.trim()) {
        next[last] = {
          ...next[last],
          content: "_No answer was returned._",
          failed: true,
        };
      }
      return next;
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open PharmaZs AI Assistant"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-violet text-white shadow-lg transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2"
      >
        <Sparkles size={22} aria-hidden />
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="PharmaZs AI Assistant"
      className="fixed bottom-6 right-6 z-50 flex h-[560px] w-[400px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
    >
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border bg-sidebar px-4 py-3">
        <Sparkles size={16} className="text-accent-teal" aria-hidden />
        <span className="text-[13px] font-semibold text-white">PharmaZs AI Assistant</span>
        {role && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-sidebar-muted">
            {role}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            abortRef.current?.abort();
            setOpen(false);
          }}
          aria-label="Close assistant"
          className="ml-auto text-sidebar-muted transition hover:text-white"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      {/* transcript */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg bg-violet-bg p-3">
              <MessageSquare size={14} className="mt-0.5 shrink-0 text-violet" aria-hidden />
              <p className="text-[12px] leading-relaxed text-text">
                Ask about sales, products, HCPs, inventory, forecasts or why a
                number moved. Answers are grounded in live MySQL records and
                scoped to your role.
              </p>
            </div>
            <p className="text-[11px] font-medium text-text-muted">Try one of these</p>
            <div className="space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-left text-[12px] text-text transition hover:border-violet hover:bg-violet-bg"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          if (m.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-[12px] text-white">
                  {m.content}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="flex flex-col items-start gap-1">
              <div
                className={`max-w-[92%] rounded-lg rounded-bl-sm border px-3 py-2 ${
                  m.failed
                    ? "border-danger/30 bg-danger-bg"
                    : "border-border bg-bg"
                }`}
              >
                {m.content ? (
                  <Markdown content={m.content} />
                ) : (
                  <TypingDots />
                )}
                {isLast && streaming && m.content && (
                  <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-violet align-middle" />
                )}
              </div>
              {(m.intent || m.mock) && (
                <div className="flex items-center gap-1.5 pl-1">
                  {m.intent && (
                    <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] text-text-muted">
                      {m.intent.replace(/_QUERY$/, "").toLowerCase()}
                    </span>
                  )}
                  {m.mock && (
                    <span className="rounded bg-warning-bg px-1.5 py-0.5 text-[10px] text-text">
                      mock — no GEMINI_API_KEY
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-bg p-2.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-danger" aria-hidden />
            <p className="text-[11px] leading-relaxed text-text">{error}</p>
          </div>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            disabled={streaming}
            placeholder={streaming ? "Answering…" : "Ask about your commercial data…"}
            aria-label="Message"
            className="max-h-24 min-h-[36px] flex-1 resize-y rounded-lg border border-border bg-card px-3 py-2 text-[12px] text-text placeholder:text-text-muted focus:border-violet focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={streaming || !input.trim()}
            aria-label="Send message"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={15} aria-hidden />
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-text-muted">
          Grounded in live database records. Verify figures before acting on them.
        </p>
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-0.5" aria-label="Assistant is typing">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
