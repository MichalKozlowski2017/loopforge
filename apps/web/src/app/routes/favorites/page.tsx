"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RouteSummaryList } from "@/components/RouteSummaryList";
import { RoutesLibraryNav } from "@/components/RoutesLibraryNav";
import {
  MAX_FAVORITE_ROUTES,
  type CloudRouteSummary,
} from "@/lib/cloud-routes-store";

export default function FavoriteRoutesPage() {
  const [routes, setRoutes] = useState<CloudRouteSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/routes?favorites=1");
        if (response.status === 401) {
          if (!cancelled) {
            setNeedsLogin(true);
            setReady(true);
          }
          return;
        }
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (!cancelled) {
            setError(payload?.error ?? "Nie udało się pobrać ulubionych.");
            setReady(true);
          }
          return;
        }
        const payload = (await response.json()) as {
          routes?: CloudRouteSummary[];
        };
        if (!cancelled) {
          setRoutes(payload.routes ?? []);
          setReady(true);
        }
      } catch {
        if (!cancelled) {
          setError("Nie udało się pobrać ulubionych.");
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-2">
        <h1 className="text-2xl font-semibold">Ulubione trasy</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Świadomie zapisane pętle (do {MAX_FAVORITE_ROUTES}). Nie znikają przy
          czyszczeniu historii generacji.
        </p>
      </div>
      <RoutesLibraryNav active="favorites" />

      {!ready ? (
        <p className="text-zinc-500">Ładowanie…</p>
      ) : needsLogin ? (
        <div className="rounded-xl border border-amber-950/25 bg-zinc-900/50 p-8 text-center">
          <p className="text-zinc-400">
            Zaloguj się, żeby zobaczyć ulubione trasy.
          </p>
          <Link
            href="/login?next=/routes/favorites"
            className="mt-4 inline-block text-sm text-amber-400 hover:underline"
          >
            → Zaloguj się
          </Link>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-6 text-sm text-red-200">
          {error}
        </div>
      ) : routes.length === 0 ? (
        <div className="rounded-xl border border-amber-950/25 bg-zinc-900/50 p-8 text-center">
          <p className="text-zinc-400">
            Brak ulubionych. Otwórz trasę z historii i kliknij „Zapisz w
            ulubionych”.
          </p>
          <Link
            href="/routes"
            className="mt-4 inline-block text-sm text-amber-400 hover:underline"
          >
            → Historia
          </Link>
        </div>
      ) : (
        <RouteSummaryList routes={routes} removeOnUnfavorite />
      )}
    </main>
  );
}
