"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { tokenStore } from "@/lib/token-store";
import { CenteredSpinner } from "@/components/ui/States";
import type { AuthUser } from "@/lib/types";

/**
 * The application shell (Contract §7): fixed 264px sidebar, 64px topbar, and a
 * centred content column. Guards auth client-side — redirects to /login when no
 * access token is present.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (!tokenStore.isAuthenticated()) {
      router.replace("/login");
      return;
    }
    setUser(tokenStore.getUser());
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <CenteredSpinner label="Loading PharmaZs…" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar user={user} />
      <div className="pl-[264px]">
        <Topbar />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">{children}</main>
      </div>
      {/* Rendered inside the auth guard so it never appears on /login, and once
          here rather than per page so the conversation survives navigation. */}
      <ChatWidget />
    </div>
  );
}
