import { ChevronRight } from "lucide-react";

/** Breadcrumb "PharmaZs / <Section>" with the current crumb semibold (§7). */
export function Breadcrumb({ section }: { section: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[14px]">
      <span className="text-text-muted">PharmaZs</span>
      <ChevronRight size={15} className="text-text-muted" />
      <span className="font-semibold text-text">{section}</span>
    </nav>
  );
}
