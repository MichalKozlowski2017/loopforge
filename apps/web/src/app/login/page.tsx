"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Provider = "google" | "apple";

function LoginInner() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const next = searchParams.get("next") ?? "/";
  const [busy, setBusy] = useState<Provider | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function signIn(provider: Provider) {
    setBusy(provider);
    setLocalError(null);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          queryParams:
            provider === "google" ? { prompt: "select_account" } : undefined,
        },
      });
      if (oauthError) {
        setLocalError(oauthError.message);
        setBusy(null);
      }
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Nie udało się rozpocząć logowania.",
      );
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-4 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-500/90">
        Loopforge
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">
        Zaloguj się
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
        Generowanie tras wymaga konta. Mapa i ustawienia działają bez logowania — sesja chroni
        silnik przed nadużyciem.
      </p>

      {(error === "auth" || localError) && (
        <p
          className="mt-6 rounded-lg border border-red-500/40 bg-red-950/50 px-3 py-2 text-sm text-red-200"
          role="alert"
        >
          {localError ?? "Logowanie nie powiodło się. Spróbuj ponownie."}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void signIn("google")}
          className="inline-flex h-12 items-center justify-center gap-3 rounded-xl border border-zinc-600 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100 disabled:opacity-60"
        >
          <GoogleIcon />
          {busy === "google" ? "Przekierowanie…" : "Kontynuuj z Google"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void signIn("apple")}
          className="inline-flex h-12 items-center justify-center gap-3 rounded-xl border border-zinc-500 bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60"
        >
          <AppleIcon />
          {busy === "apple" ? "Przekierowanie…" : "Kontynuuj z Apple"}
        </button>
      </div>

      <p className="mt-8 text-center text-sm text-zinc-500">
        <a href="/" className="font-medium text-zinc-300 underline-offset-2 hover:text-amber-200 hover:underline">
          Wróć do mapy
        </a>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-[70vh] w-full max-w-md items-center justify-center px-4">
          <p className="text-sm text-zinc-500">Ładowanie…</p>
        </main>
      }
    >
      <LoginInner />
    </Suspense>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" fill="currentColor" aria-hidden="true">
      <path d="M13.032 9.56c-.022-2.24 1.83-3.314 1.913-3.364-1.042-1.524-2.663-1.733-3.24-1.756-1.38-.14-2.693.812-3.392.812-.7 0-1.782-.791-2.928-.77-1.507.022-2.896.876-3.67 2.225-1.565 2.715-.4 6.734 1.124 8.937.746 1.078 1.635 2.29 2.803 2.246 1.125-.045 1.55-.726 2.91-.726 1.36 0 1.742.726 2.928.703 1.21-.022 1.977-1.098 2.717-2.18.857-1.25 1.21-2.46 1.232-2.523-.027-.012-2.36-.905-2.397-3.604ZM10.73 2.68c.62-.752 1.038-1.796.923-2.836-0.893.036-1.973.595-2.614 1.346-.575.666-1.078 1.73-.943 2.752 1 .078 2.023-.508 2.634-1.262Z" />
    </svg>
  );
}
