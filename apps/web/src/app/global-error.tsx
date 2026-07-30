"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="pl">
      <body className="flex min-h-dvh items-center justify-center bg-zinc-950 px-4 text-zinc-100">
        <main className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 text-center">
          <h1 className="text-xl font-semibold">Coś poszło nie tak</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Błąd został zarejestrowany. Spróbuj odświeżyć stronę.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-5 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-amber-400"
          >
            Spróbuj ponownie
          </button>
        </main>
      </body>
    </html>
  );
}
