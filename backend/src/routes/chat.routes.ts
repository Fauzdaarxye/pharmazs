import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import { config } from '../config';
import { fail } from '../http/envelope';
import { asyncHandler } from '../http/middleware';
import { authenticate, principal } from '../auth/middleware';
import { logger } from '../logger';

export const chatRouter = Router();
chatRouter.use(authenticate);

/**
 * Initial-connection timeout for the ML service.
 *
 * Deliberately NOT config.ml.timeoutMs (5s): that budget is sized for a
 * request/response analytics call, and a chat answer streams for far longer than
 * that. Reusing it would abort every stream mid-sentence. This guards only the
 * time to FIRST BYTE — once the stream is open it is allowed to run to
 * completion, and a client that goes away is handled by the abort below.
 */
const CONNECT_TIMEOUT_MS = 20_000;

/** Cap on conversation history forwarded upstream, to bound prompt size. */
const MAX_HISTORY_TURNS = 12;

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * POST /api/chat — proxy a RAG chat turn to the ML service and stream SSE back.
 *
 * The roleScope is built HERE, from the verified JWT principal, and is the only
 * source of data scoping downstream. It is never read from the request body: if
 * it were, a SALES_REP could grant themselves enterprise-wide visibility by
 * editing one JSON field.
 */
chatRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const p = principal(req);

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json(fail('VALIDATION_ERROR', 'message is required'));
    }
    if (message.length > 2000) {
      return res.status(400).json(fail('VALIDATION_ERROR', 'message must be 2000 characters or fewer'));
    }

    const rawHistory: unknown = req.body?.history;
    const history: ChatTurn[] = Array.isArray(rawHistory)
      ? rawHistory
          .filter(
            (t): t is ChatTurn =>
              !!t &&
              (t.role === 'user' || t.role === 'assistant') &&
              typeof t.content === 'string',
          )
          .slice(-MAX_HISTORY_TURNS)
      : [];

    // Only attach the id that the role is actually scoped by. Sending both would
    // let the ML service pick the wider one.
    const roleScope = {
      role: p.role,
      regionId: p.role === 'MANAGER' ? p.regionId : undefined,
      repId: p.role === 'SALES_REP' ? p.repId : undefined,
    };

    const controller = new AbortController();
    // If the browser closes the tab mid-answer, stop generating upstream rather
    // than paying for tokens nobody will read.
    res.on('close', () => controller.abort());

    const connectTimer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${config.ml.baseUrl}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ message, history, roleScope }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(connectTimer);
      logger.warn({ err: (err as Error).message }, 'Chat: ML service unreachable');
      return res
        .status(503)
        .json(fail('ML_UNAVAILABLE', 'The assistant service is currently unavailable'));
    }
    // First byte received: the connect budget no longer applies.
    clearTimeout(connectTimer);

    if (!upstream.ok || !upstream.body) {
      logger.warn({ status: upstream.status }, 'Chat: ML service returned non-2xx');
      return res
        .status(502)
        .json(fail('ML_UNAVAILABLE', `The assistant service returned ${upstream.status}`));
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Tell any intermediate proxy not to buffer, or the answer arrives all at
    // once at the end and the streaming UI is pointless.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      // fetch gives a WHATWG stream; Express wants a Node stream.
      await new Promise<void>((resolve, reject) => {
        const nodeStream = Readable.fromWeb(upstream.body as never);
        nodeStream.on('error', reject);
        nodeStream.on('end', resolve);
        nodeStream.pipe(res, { end: true });
      });
    } catch (err) {
      // Headers are already sent, so an error cannot become a JSON envelope.
      // Emit a terminal SSE error frame instead, which the client understands.
      const aborted = (err as Error).name === 'AbortError';
      if (!aborted) {
        logger.error({ err: (err as Error).message }, 'Chat: stream failed mid-flight');
      }
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: 'The answer stream ended unexpectedly' })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
    }
  }),
);
