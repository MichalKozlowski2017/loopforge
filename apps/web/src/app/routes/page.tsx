"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getRideProfileLabel } from "@loopforge/osm-types";
import {
  MAX_CLOUD_ROUTES,
  type CloudRouteSummary,
} from "@/lib/cloud-routes-store";

const BIKE_LABELS: Record<CloudRouteSummary["bikeType"], string> = {
  gravel: "Gravel",
  road: "Szosa",
  mtb: "MTB",
  general: "Ogólny",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RoutesPage() {
  const [routes, setRoutes] = useState<CloudRouteSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/routes");
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
            setError(payload?.error ?? "Nie udało się pobrać historii.");
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
          setError("Nie udało się pobrać historii.");
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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Historia tras</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Twoje wygenerowane pętle — zapisane w chmurze na Twoim koncie (do{" "}
          {MAX_CLOUD_ROUTES} ostatnich).
        </p>
      </div>

      {!ready ? (
        <p className="text-zinc-500">Ładowanie…</p>
      ) : needsLogin ? (
        <div className="rounded-xl border border-amber-950/25 bg-zinc-900/50 p-8 text-center">
          <p className="text-zinc-400">
            Zaloguj się, żeby zobaczyć historię tras na koncie.
          </p>
          <Link
            href="/login?next=/routes"
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
          <p className="text-zinc-400">Brak tras. Wygeneruj pierwszą pętlę.</p>
          <Link
            href="/"
            className="mt-4 inline-block text-sm text-amber-400 hover:underline"
          >
            → Generator
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {routes.map((route) => (
            <li key={route.id}>
              <Link
                href={`/routes/${route.id}`}
                className="block rounded-xl border border-amber-950/25 bg-zinc-900/50 p-4 transition hover:border-amber-700/35"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-zinc-100">
                      {BIKE_LABELS[route.bikeType]} · {route.distanceKm.toFixed(1)}{" "}
                      km · {route.direction}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {formatDate(route.createdAt)} · score{" "}
                      {(route.score * 100).toFixed(0)}%
                      {route.profile
                        ? ` · ${getRideProfileLabel(route.bikeType, route.profile) ?? route.profile}`
                        : ""}
                    </p>
                    {route.notes ? (
                      <p className="mt-2 text-sm text-zinc-400 italic">
                        „{route.notes}&rdquo;
                      </p>
                    ) : null}
                  </div>
                  <div className="text-lg">
                    {route.rating === "up"
                      ? "👍"
                      : route.rating === "down"
                        ? "👎"
                        : "—"}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
