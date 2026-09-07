"use client";

/**
 * RFC 4180-ish CSV builder + Blob download. Everything is client-side because
 * there is no server-side export endpoint (do not invent one). Cells are escaped:
 * a value containing a comma, double-quote, CR or LF is wrapped in double quotes
 * and its own quotes are doubled.
 */

export type CsvColumn<Row> = {
  header: string;
  /** Return a primitive; it is stringified and escaped by toCsv. */
  value: (row: Row) => string | number | null | undefined;
};

function escapeCell(input: string | number | null | undefined): string {
  if (input == null) return "";
  const s = String(input);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv<Row>(rows: Row[], columns: CsvColumn<Row>[]): string {
  const head = columns.map((c) => escapeCell(c.header)).join(",");
  const body = rows
    .map((row) => columns.map((c) => escapeCell(c.value(row))).join(","))
    .join("\r\n");
  // Leading BOM so Excel opens the ₹ symbol and UTF-8 correctly.
  return `\uFEFF${head}\r\n${body}`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the click has been dispatched.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
