import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./server";
import { getSupabaseUrl, isSupabaseConfigured } from "./env";

export function getSupabaseServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined;
}

export function isServiceRoleConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseServiceRoleKey());
}

/** Privileged server-only client — never import into client components. */
export function createServiceClient() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY / URL na serwerze.");
  }
  return createSupabaseClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function isAdminUser(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.app_metadata?.role === "admin";
}

export type AdminResult =
  | { ok: true; user: User }
  | { ok: false; status: number; error: string };

/** Require logged-in user with app_metadata.role = admin. */
export async function requireAdmin(): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "Supabase nie jest skonfigurowane.",
    };
  }
  if (!isServiceRoleConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "Brak SUPABASE_SERVICE_ROLE_KEY — panel admina wyłączony.",
    };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      return {
        ok: false,
        status: 401,
        error: "Zaloguj się jako administrator.",
      };
    }
    if (!isAdminUser(user)) {
      return {
        ok: false,
        status: 403,
        error: "Brak uprawnień administratora.",
      };
    }
    return { ok: true, user };
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Nie udało się sprawdzić sesji administratora.",
    };
  }
}

/** Soft check for nav link — never throws. */
export async function getAdminViewer(): Promise<User | null> {
  try {
    if (!isSupabaseConfigured()) return null;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return isAdminUser(user) ? user : null;
  } catch {
    return null;
  }
}
