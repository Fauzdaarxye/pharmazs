"use client";

import { cn } from "@/lib/cn";

export interface SegmentOption<T extends string> {
  label: string;
  value: T;
}

/** Pill-group toggle used for Revenue|Units and Monthly|Daily (Contract §7). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-bg p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-md px-3 py-1 text-[13px] font-medium transition-colors",
              active
                ? "bg-card text-text shadow-[0_1px_2px_rgba(16,24,40,0.06)]"
                : "text-text-muted hover:text-text",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
