// JWT + refresh-token store. Client-only; every accessor is SSR-safe so it can be
// imported anywhere without crashing during server rendering.

import type { AuthUser } from "./types";

const ACCESS_KEY = "pharmaiq.accessToken";
const REFRESH_KEY = "pharmaiq.refreshToken";
const USER_KEY = "pharmaiq.user";

const isBrowser = () => typeof window !== "undefined";

export const tokenStore = {
  getAccess(): string | null {
    if (!isBrowser()) return null;
    return window.localStorage.getItem(ACCESS_KEY);
  },
  getRefresh(): string | null {
    if (!isBrowser()) return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  getUser(): AuthUser | null {
    if (!isBrowser()) return null;
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  },
  setAccess(token: string): void {
    if (!isBrowser()) return;
    window.localStorage.setItem(ACCESS_KEY, token);
  },
  setSession(accessToken: string, refreshToken: string, user: AuthUser): void {
    if (!isBrowser()) return;
    window.localStorage.setItem(ACCESS_KEY, accessToken);
    window.localStorage.setItem(REFRESH_KEY, refreshToken);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear(): void {
    if (!isBrowser()) return;
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    window.localStorage.removeItem(USER_KEY);
  },
  isAuthenticated(): boolean {
    return !!tokenStore.getAccess();
  },
};
