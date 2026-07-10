"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { StoredRoute } from "@loopforge/osm-types";
import {
  RouteForm,
  type RouteFormValues,
} from "@/components/RouteForm";

const MapView = dynamic(
  () => import("@/components/MapView").then((mod) => mod.MapView),
  { ssr: false, loading: () => <div className="h-full animate-pulse rounded-xl bg-zinc-800" /> },
);

const DEFAULT_FORM: RouteFormValues = {
  bikeType: "gravel",
  distanceKm: 45,
  direction: "NE",
  lat: 52.2297,
  lng: 21.0122,
};

export default function HomePage() {
  const [form, setForm] = useState<RouteFormValues>(DEFAULT_FORM);
  const [route, setRoute] = useState<StoredRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/routes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: { lat: form.lat, lng: form.lng },
          bikeType: form.bikeType,
          distanceKm: form.distanceKm,
          direction: form.direction,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Nie udało się wygenerować trasy");
      }

      const generated = (await response.json()) as StoredRoute;
      setRoute(generated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nieznany błąd");
    } finally {
      setLoading(false);
    }
  }

  async function handleRate(rating: "up" | "down") {
    if (!route) return;

    const response = await fetch(`/api/routes/${route.id}/rate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    });

    if (response.ok) {
      const updated = (await response.json()) as StoredRoute;
      setRoute(updated);
    }
  }

  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      <aside className="w-full border-b border-zinc-800 p-6 lg:w-96 lg:border-b-0 lg:border-r">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">
            Loopforge
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Kuźnia pętli</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Generuj pętlę po drogach OSM — wymaga lokalnego BRoutera.
          </p>
        </div>

        <RouteForm
          values={form}
          loading={loading}
          onChange={setForm}
          onSubmit={handleGenerate}
        />

        {error ? (
          <p className="mt-4 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        {route ? (
          <section className="mt-6 space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="text-sm font-medium text-zinc-200">Metryki</h2>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-zinc-500">Dystans</dt>
                <dd>{route.metrics.distanceKm.toFixed(1)} km</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Przewyższenie</dt>
                <dd>~{route.metrics.elevationGainM} m</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Score</dt>
                <dd>{(route.metrics.score * 100).toFixed(0)}%</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Tryb</dt>
                <dd className="capitalize">{route.bikeType}</dd>
              </div>
            </dl>

            <div className="flex gap-2 pt-2">
              <a
                href={`/api/routes/${route.id}/gpx`}
                className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-center text-sm hover:border-zinc-500"
              >
                Pobierz GPX
              </a>
              <button
                type="button"
                onClick={() => handleRate("up")}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  route.rating === "up"
                    ? "border-emerald-500 text-emerald-300"
                    : "border-zinc-700 hover:border-zinc-500"
                }`}
              >
                👍
              </button>
              <button
                type="button"
                onClick={() => handleRate("down")}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  route.rating === "down"
                    ? "border-red-500 text-red-300"
                    : "border-zinc-700 hover:border-zinc-500"
                }`}
              >
                👎
              </button>
            </div>
          </section>
        ) : null}
      </aside>

      <section className="relative min-h-[50vh] flex-1 p-4 lg:min-h-screen">
        <MapView
          center={[form.lng, form.lat]}
          route={route?.geojson ?? null}
        />
      </section>
    </main>
  );
}
