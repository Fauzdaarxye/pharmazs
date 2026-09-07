"use client";

import { usePathname } from "next/navigation";
import { Search, Calendar, Sparkles, Bell, HelpCircle } from "lucide-react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { sectionForPath } from "@/lib/constants";

export function Topbar({ notifications = 3 }: { notifications?: number }) {
  const pathname = usePathname();
  const section = sectionForPath(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border bg-card px-6">
      <Breadcrumb section={section} />

      {/* Centre search */}
      <div className="mx-auto hidden w-full max-w-md items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 md:flex">
        <Search size={16} className="text-text-muted" />
        <input
          type="search"
          placeholder="Search products, HCPs, regions…"
          className="w-full bg-transparent text-[13px] text-text outline-none placeholder:text-text-muted"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* Date-range picker */}
        <button
          type="button"
          className="hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-medium text-text transition-colors hover:bg-bg lg:flex"
        >
          <Calendar size={15} className="text-text-muted" />
          Last 12 Months
        </button>

        {/* AI Insights Active pill */}
        <span className="hidden items-center gap-1.5 rounded-full border border-violet/40 bg-violet-bg px-3 py-1.5 text-[12px] font-semibold text-violet sm:flex">
          <Sparkles size={14} /> AI Insights Active
        </span>

        {/* Bell with red badge */}
        <button
          type="button"
          aria-label="Notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:bg-bg hover:text-text"
        >
          <Bell size={18} />
          {notifications > 0 && (
            <span className="tnum absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {notifications > 9 ? "9+" : notifications}
            </span>
          )}
        </button>

        {/* Help icon */}
        <button
          type="button"
          aria-label="Help"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:bg-bg hover:text-text"
        >
          <HelpCircle size={18} />
        </button>
      </div>
    </header>
  );
}
