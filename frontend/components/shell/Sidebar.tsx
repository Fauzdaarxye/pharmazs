"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Settings, LifeBuoy } from "lucide-react";
import { NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import type { AuthUser } from "@/lib/types";

export function Sidebar({ user }: { user: AuthUser | null }) {
  const pathname = usePathname();

  const initials = (user?.fullName ?? "PharmaZs")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-[264px] flex-col bg-sidebar text-white">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-teal/15 text-accent-teal">
          <Activity size={20} />
        </span>
        <div className="leading-tight">
          <div className="text-[17px] font-bold tracking-tight text-white">PharmaZs</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-teal">
            Commercial Intelligence
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.route || pathname.startsWith(item.route + "/");
            const Icon = item.icon;
            return (
              <li key={item.route}>
                <Link
                  href={item.route}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
                    active
                      ? "bg-sidebar-active text-white"
                      : "text-sidebar-muted hover:bg-sidebar-hover hover:text-white",
                  )}
                >
                  <Icon size={20} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom block */}
      <div className="border-t border-white/10 px-3 py-3">
        <ul className="space-y-1">
          <li>
            <Link
              href="/settings"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-white"
            >
              <Settings size={20} /> Settings
            </Link>
          </li>
          <li>
            <Link
              href="/help"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-white"
            >
              <LifeBuoy size={20} /> Help &amp; Support
            </Link>
          </li>
        </ul>

        <div className="mt-3 flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-teal/20 text-[13px] font-semibold text-accent-teal">
            {initials}
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-semibold text-white">
              {user?.fullName ?? "Guest"}
            </div>
            <div className="truncate text-[11px] text-sidebar-muted">
              {user?.role
                ? user.role.charAt(0) + user.role.slice(1).toLowerCase().replace("_", " ")
                : "Not signed in"}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
