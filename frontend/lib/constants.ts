import type { LucideIcon } from "lucide-react";
import {
  LayoutGrid,
  BarChart3,
  Package,
  Stethoscope,
  Users,
  MapPin,
  Swords,
  Boxes,
  TrendingUp,
  Bell,
  Lightbulb,
  FileText,
} from "lucide-react";

/**
 * Fixed therapeutic-area colours (Contract §7). Keep these stable across every
 * page so a colour always means the same area. Lookup is case-insensitive and
 * falls back to a neutral grey for unknown / future areas.
 */
export const TA_COLORS: Record<string, string> = {
  cardiology: "#2563EB",
  diabetes: "#10B981",
  oncology: "#8B5CF6",
  respiratory: "#F59E0B",
  neurology: "#94A3B8",
  gastroenterology: "#EC4899",
};

const TA_FALLBACK = "#94A3B8";

export function taColor(area: string | null | undefined): string {
  if (!area) return TA_FALLBACK;
  return TA_COLORS[area.trim().toLowerCase()] ?? TA_FALLBACK;
}

export interface NavItem {
  label: string;
  route: string;
  icon: LucideIcon;
}

/** Nav in the exact order and routes from Contract §7. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Overview", route: "/overview", icon: LayoutGrid },
  { label: "Dashboard", route: "/dashboard", icon: BarChart3 },
  { label: "Products", route: "/products", icon: Package },
  { label: "HCP Intelligence", route: "/hcps", icon: Stethoscope },
  { label: "Sales Representatives", route: "/sales-reps", icon: Users },
  { label: "Regions", route: "/regions", icon: MapPin },
  { label: "Competitors", route: "/competitors", icon: Swords },
  { label: "Inventory", route: "/inventory", icon: Boxes },
  { label: "Forecasting", route: "/forecasting", icon: TrendingUp },
  { label: "Alerts", route: "/alerts", icon: Bell },
  { label: "Recommendations", route: "/recommendations", icon: Lightbulb },
  { label: "Reports", route: "/reports", icon: FileText },
];

/** Map a pathname to the section label used in the breadcrumb. */
export function sectionForPath(pathname: string): string {
  const match = NAV_ITEMS.find(
    (n) => pathname === n.route || pathname.startsWith(n.route + "/"),
  );
  return match?.label ?? "Dashboard";
}

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "1";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:4000/api";
