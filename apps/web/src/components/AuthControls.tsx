"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export function AuthControls({ className = "" }: { className?: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!configured) {
      setReady(true);
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) {
        setUser(data.user);
        setReady(true);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setReady(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [configured]);

  if (!configured || !ready) {
    return null;
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className={`inline-flex h-10 items-center justify-center rounded-lg border border-zinc-600 px-3 text-sm font-medium text-zinc-200 transition hover:border-amber-500/50 hover:text-amber-200 sm:h-8 sm:rounded-md sm:px-2.5 ${className}`}
      >
        Zaloguj się
      </Link>
    );
  }

  const label =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "Konto";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span
        className="min-w-0 flex-1 truncate text-sm text-zinc-400 sm:max-w-[9rem] sm:flex-none"
        title={user.email ?? undefined}
      >
        {label}
      </span>
      <button
        type="button"
        className="inline-flex h-10 shrink-0 items-center rounded-lg border border-zinc-600 px-3 text-sm font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 sm:h-8 sm:rounded-md sm:px-2.5"
        onClick={() => {
          void createClient()
            .auth.signOut()
            .then(() => {
              window.location.href = "/";
            });
        }}
      >
        Wyloguj
      </button>
    </div>
  );
}
