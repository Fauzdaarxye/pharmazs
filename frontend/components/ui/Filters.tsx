"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export interface FilterChip {
  id: string;
  label: string;
  removable?: boolean;
}

/**
 * Removable chips + Reset + solid-blue Apply Filters (Contract §9 /dashboard).
 */
export function FilterChipBar({
  chips,
  onRemove,
  onReset,
  onApply,
}: {
  chips: FilterChip[];
  onRemove?: (id: string) => void;
  onReset?: () => void;
  onApply?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-text"
        >
          {chip.label}
          {chip.removable !== false && onRemove && (
            <button
              type="button"
              aria-label={`Remove ${chip.label}`}
              onClick={() => onRemove(chip.id)}
              className="text-text-muted transition-colors hover:text-danger"
            >
              <X size={14} />
            </button>
          )}
        </span>
      ))}
      <div className="ml-auto flex items-center gap-2">
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-text-muted transition-colors hover:text-text"
          >
            Reset
          </button>
        )}
        {onApply && (
          <button
            type="button"
            onClick={onApply}
            className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            Apply Filters
          </button>
        )}
      </div>
    </div>
  );
}

export interface SelectFilter {
  id: string;
  label: string;
  value: string;
  options: string[];
}

/** Labelled dropdown bar — "Specialty: All" etc. (Contract §9 /hcps). */
export function FilterSelectBar({
  title,
  filters,
  onChange,
  className,
}: {
  title?: string;
  filters: SelectFilter[];
  onChange: (id: string, value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {title && (
        <span className="text-[13px] font-semibold text-text">{title}</span>
      )}
      {filters.map((f) => (
        <label
          key={f.id}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px]"
        >
          <span className="text-text-muted">{f.label}:</span>
          <select
            value={f.value}
            onChange={(e) => onChange(f.id, e.target.value)}
            className="cursor-pointer bg-transparent font-medium text-text outline-none"
          >
            {f.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
