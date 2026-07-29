import type { User } from "@supabase/supabase-js";
import { createClient } from "./server";
import { isAuthRequired, isSupabaseConfigured } from "./env";

export type AuthResult =
  | { ok: true; user: User | null }
  | { ok: false; status: number; error: string };

/** Require a verified Supabase user when auth is enabled. */
export async function requireUser(): Promise<AuthResult> {
  if (!isAuthRequired()) {
    return { ok: true, user: null };
  }
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "Logowanie nie jest skonfigurowane na serwerze.",
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
        error: "Zaloguj się, żeby generować trasy.",
      };
    }
    return { ok: true, user };
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Nie udało się sprawdzić sesji logowania.",
    };
  }
}
