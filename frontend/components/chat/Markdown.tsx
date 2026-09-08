"use client";

import { Fragment, memo, type ReactNode } from "react";

/**
 * Minimal markdown renderer for assistant messages.
 *
 * Deliberately hand-rolled instead of adding react-markdown:
 *  - it renders to React ELEMENTS, never dangerouslySetInnerHTML, so model
 *    output cannot inject markup into the dashboard;
 *  - the model is instructed to emit a small, known subset (headings, bold,
 *    bullets, inline code, tables) and tables are the important one, because the
 *    retrieved data context is itself markdown tables;
 *  - it keeps the frontend dependency list unchanged.
 *
 * Anything outside the supported subset degrades to plain text rather than
 * showing raw syntax noise.
 */

/** Inline formatting: **bold**, `code`, _italic_. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // One pass over the three inline markers, longest-delimiter first so that
  // ** is not consumed by the single-underscore rule.
  //
  // The `_italic_` arm needs BOTH properties, and getting one without the other
  // produced a visible bug each way:
  //   * delimiters must sit at word boundaries, or the underscores inside
  //     "GEMINI_API_KEY" become emphasis markers and it renders as
  //     "GEMINI<em>API</em>KEY";
  //   * the span must still be allowed to CONTAIN underscores, or a line like
  //     "_Set GEMINI_API_KEY ..._" matches nothing and the raw underscores are
  //     shown to the user.
  // Hence: boundary-guarded delimiters plus a lazy body that may include "_".
  //
  // The single-asterisk arm is last and guarded with (?!\*) so it cannot eat a
  // "**bold**" opener. Gemini emits *this* form for emphasis more often than
  // _this_ one, and without the arm the asterisks rendered literally.
  const pattern =
    /(\*\*[^*]+\*\*|`[^`]+`|(?<![A-Za-z0-9_])_(?=\S)([^\n]*?\S)_(?![A-Za-z0-9_])|\*(?!\*)(?=\S)[^*\n]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${i++}`;
    if (token.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-text">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      out.push(
        <code
          key={key}
          className="rounded bg-bg px-1 py-0.5 font-mono text-[11px] text-text"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      // Either _italic_ or *italic* — both carry a single-char delimiter.
      out.push(
        <em key={key} className="text-text-muted">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

function isTableDivider(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

/**
 * Memoised on `content`: during a stream the parent re-renders on every flush,
 * and without this EVERY message in the transcript would be re-parsed each time
 * — quadratic work that crashed the renderer on a long answer. Only the message
 * whose text actually changed now re-parses.
 */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ---- table ----
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={`t${key++}`} className="my-2 -mx-1 overflow-x-auto px-1">
          {/* w-max, not w-full: in a 400px panel a 6-column table must SCROLL.
              Forcing it to fit crushed the columns and clipped the last one
              off the panel edge entirely. */}
          <table className="w-max min-w-full border-collapse text-[11px]">
            <thead>
              <tr>
                {headers.map((h, hi) => (
                  <th
                    key={hi}
                    className="whitespace-nowrap border-b border-border px-2 py-1 text-left font-semibold text-text-muted"
                  >
                    {renderInline(h, `h${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="align-top">
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      className="tnum whitespace-nowrap border-b border-border/60 px-2 py-1"
                    >
                      {renderInline(c, `c${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // ---- heading ----
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={`h${key++}`} className="mt-2 mb-1 font-semibold text-text">
          {renderInline(heading[2], `hd${key}`)}
        </p>,
      );
      i++;
      continue;
    }

    // ---- bullet list ----
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`u${key++}`} className="my-1 list-disc space-y-0.5 pl-4">
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `li${ii}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // ---- numbered list ----
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={`o${key++}`} className="my-1 list-decimal space-y-0.5 pl-4">
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `oli${ii}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // ---- blank line ----
    if (!line.trim()) {
      i++;
      continue;
    }

    // ---- paragraph (consume until a blank line or a block starter) ----
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isTableRow(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`p${key++}`} className="my-1 leading-relaxed">
        {para.map((l, li) => (
          <Fragment key={li}>
            {li > 0 && <br />}
            {renderInline(l, `p${key}-${li}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="text-[12px] text-text">{blocks}</div>;
});
