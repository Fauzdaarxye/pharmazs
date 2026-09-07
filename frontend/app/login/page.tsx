"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Activity, Loader2, ArrowRight } from "lucide-react";
import { endpoints } from "@/lib/api";
import { tokenStore } from "@/lib/token-store";
import { USE_MOCKS } from "@/lib/constants";

const DEMO_ACCOUNTS = [
  { email: "admin@pharmaiq.io", role: "Admin" },
  { email: "exec@pharmaiq.io", role: "Executive" },
  { email: "manager@pharmaiq.io", role: "Manager" },
  { email: "rep@pharmaiq.io", role: "Sales Rep" },
  { email: "analyst@pharmaiq.io", role: "Analyst" },
];
const DEMO_PASSWORD = "PharmaIQ@2026";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("exec@pharmaiq.io");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await endpoints.login(email.trim(), password);
      tokenStore.setSession(res.accessToken, res.refreshToken, res.user);
      router.replace("/dashboard");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Login failed. Check your credentials.",
      );
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-teal/15 text-accent-teal">
            <Activity size={22} />
          </span>
          <div className="leading-tight">
            <div className="text-[20px] font-bold">PharmaIQ</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-teal">
              Commercial Intelligence
            </div>
          </div>
        </div>
        <div className="max-w-md">
          <h1 className="text-[32px] font-bold leading-tight">
            Turn pharmaceutical data into commercial decisions.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-sidebar-muted">
            Revenue performance, HCP prioritisation, demand forecasting and risk
            detection — one intelligence layer across every region and therapeutic
            area.
          </p>
        </div>
        <div className="text-[12px] text-sidebar-muted">
          © 2026 PharmaIQ. Internal analytics platform.
        </div>
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-teal/10 blur-3xl"
          aria-hidden
        />
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-bg px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar text-accent-teal">
                <Activity size={22} />
              </span>
              <div className="text-[20px] font-bold text-text">PharmaIQ</div>
            </div>
          </div>

          <h2 className="text-[24px] font-bold text-text">Sign in</h2>
          <p className="mt-1 text-[14px] text-text-muted">
            Access your commercial intelligence dashboard.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-text">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-[14px] text-text outline-none transition-colors focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-text">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-[14px] text-text outline-none transition-colors focus:border-primary"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2.5 text-[13px] font-medium text-danger"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <>
                  Sign in <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Demo accounts */}
          <div className="mt-8 rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-text">Demo accounts</span>
              <span className="text-[12px] text-text-muted">
                password: <code className="text-text">{DEMO_PASSWORD}</code>
              </span>
            </div>
            <ul className="space-y-1">
              {DEMO_ACCOUNTS.map((acc) => (
                <li key={acc.email}>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(acc.email);
                      setPassword(DEMO_PASSWORD);
                    }}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-bg"
                  >
                    <span className="font-medium text-text">{acc.email}</span>
                    <span className="text-text-muted">{acc.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {USE_MOCKS && (
            <p className="mt-4 text-center text-[12px] text-text-muted">
              Running in mock mode — any of the accounts above will sign you in.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
