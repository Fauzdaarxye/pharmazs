"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { tokenStore } from "@/lib/token-store";
import { CenteredSpinner } from "@/components/ui/States";

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(tokenStore.isAuthenticated() ? "/dashboard" : "/login");
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <CenteredSpinner label="Loading PharmaZs…" />
    </div>
  );
}
