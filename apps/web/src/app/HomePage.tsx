"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type {
  RouteGenerationProgress,
  StoredRoute,
} from "@loopforge/osm-types";
import {
  RouteForm,
  type RouteFormValues,
} from "@/components/RouteForm";
import { SurfaceBreakdown } from "@/components/SurfaceBreakdown";
import { MapGenerationOverlay } from "@/components/MapGenerationOverlay";
import { SurfaceLegend } from "@/components/SurfaceLegend";
import { useGeolocation } from "@/lib/use-geolocation";
import { consumeGenerationStream } from "@/lib/parse-generation-stream";

const MapView = dynamic(
  () => import("@/components/MapView").then((mod) => mod.MapView),
  {
    ssr: false,
    loading: () => (
      <div className="h-full animate-pulse rounded-xl bg-zinc-800" />
    ),
  },
);

const FALLBACK_START = { lat: 52.2297, lng: 21.0122 };

function extractLoopEntry(route: StoredRoute | null): { lat: number; lng: number } | null {
  if (!route) return null;
  if (route.loopEntry) return route.loopEntry;
  const entry = route.geojson.properties.loopEntry;
  if (
    entry &&
    typeof entry === "object" &&
    "lat" in entry &&
    "lng" in entry &&
    typeof (entry as { lat: unknown }).lat === "number" &&
    typeof (entry as { lng: unknown }).lng === "number"
  ) {
    return entry as { lat: number; lng: number };
  }
  return null;
}

const DEFAULT_FORM: RouteFormValues = {
  bikeType: "gravel",
  distanceKm: 45,
  direction: "NE",
  profile: "flow",
  avoidAsphalt: true,
  approachEnabled: false,
  approachDistanceKm: 10,
  ...FALLBACK_START,
};

export default function HomePage() {
  const searchParams = useSearchParams();
  const routeIdFromUrl = searchParams.get("routeId");

  const [form, setForm] = useState<RouteFormValues>(DEFAULT_FORM);
  const [route, setRoute] = useState<StoredRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [generationProgress, setGenerationProgress] =
    useState<RouteGenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [pickOnMap, setPickOnMap] = useState(false);
  const [locationMode, setLocationMode] = useState<
    "loading" | "ready" | "denied" | "unavailable" | "manual"
  >("loading");

  const onGeolocation = useCallback((lat: number, lng: number) => {
    setForm((current) => ({ ...current, lat, lng }));
    setLocationMode("ready");
  }, []);

  const { status: geoStatus, refresh: refreshGeolocation } = useGeolocation(
    onGeolocation,
    !routeIdFromUrl,
  );

  useEffect(() => {
    if (routeIdFromUrl) return;
    if (geoStatus === "denied") setLocationMode("denied");
    if (geoStatus === "unavailable") setLocationMode("unavailable");
    if (geoStatus === "loading") setLocationMode("loading");
  }, [geoStatus, routeIdFromUrl]);

  useEffect(() => {
    if (!routeIdFromUrl) return;

    void fetch(`/api/routes/${routeIdFromUrl}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: StoredRoute | null) => {
        if (!data) return;
        setRoute(data);
        setNotes(data.notes ?? "");
        setForm({
          bikeType: data.bikeType,
          distanceKm: Math.round(
            data.metrics.loopDistanceKm ?? data.metrics.distanceKm,
          ),
          direction: data.direction,
          profile: data.profile ?? "flow",
          avoidAsphalt: data.avoidAsphalt ?? (data.bikeType === "mtb" || data.bikeType === "gravel"),
          approachEnabled: data.approachEnabled ?? false,
          approachDistanceKm: data.approachDistanceKm ?? 10,
          lat: data.start.lat,
          lng: data.start.lng,
        });
        setLocationMode("manual");
      });
  }, [routeIdFromUrl]);

  function handleStartChange(start: { lat: number; lng: number }) {
    setForm((current) => ({
      ...current,
      lat: start.lat,
      lng: start.lng,
    }));
    setLocationMode("manual");
    setPickOnMap(false);
  }

  function handleFormChange(values: RouteFormValues) {
    setForm(values);
    setLocationMode("manual");
  }

  function handleUseMyLocation() {
    setPickOnMap(false);
    setLocationMode("loading");
    refreshGeolocation();
  }

  useEffect(() => {
    if (!loading) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [loading]);

  async function handleGenerate() {
    setLoading(true);
    setLoadingSeconds(0);
    setGenerationProgress(null);
    setError(null);
    setPickOnMap(false);

    const tick = window.setInterval(() => {
      setLoadingSeconds((seconds) => seconds + 1);
    }, 1000);

    try {
      const response = await fetch("/api/routes/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          start: { lat: form.lat, lng: form.lng },
          bikeType: form.bikeType,
          distanceKm: form.distanceKm,
          direction: form.direction,
          profile: form.profile,
          avoidAsphalt:
            form.bikeType === "gravel" || form.bikeType === "mtb"
              ? form.avoidAsphalt
              : undefined,
          approachEnabled: form.approachEnabled || undefined,
          approachDistanceKm: form.approachEnabled
            ? form.approachDistanceKm
            : undefined,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      const generated = await consumeGenerationStream(response, (progress) => {
        setGenerationProgress(progress);
      });
      setRoute(generated);
      setNotes("");
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        setError(
          "Generowanie trwa zbyt długo (>2 min). Spróbuj krótszego dystansu lub odczekaj chwilę.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Nieznany błąd");
      }
    } finally {
      window.clearInterval(tick);
      setLoading(false);
    }
  }

  async function handleRate(rating: "up" | "down") {
    if (!route) return;

    const response = await fetch(`/api/routes/${route.id}/rate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, notes }),
    });

    if (response.ok) {
      const updated = (await response.json()) as StoredRoute;
      setRoute(updated);
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="relative order-1 h-[min(46vh,26rem)] min-h-[240px] shrink-0 p-3 lg:order-2 lg:min-h-0 lg:h-auto lg:flex-1 lg:p-4">
        <MapView
          center={[form.lng, form.lat]}
          start={{ lat: form.lat, lng: form.lng }}
          route={route?.geojson ?? null}
          mapGeojson={route?.mapGeojson ?? null}
          pickStart={pickOnMap && !loading}
          onStartChange={handleStartChange}
          loopEntry={route?.loopEntry ?? extractLoopEntry(route) ?? null}
        />
        {loading ? (
          <MapGenerationOverlay
            seconds={loadingSeconds}
            progress={generationProgress}
            showApproach={form.approachEnabled}
          />
        ) : null}
        {route?.mapGeojson ? <SurfaceLegend /> : null}
      </section>

      <aside className="order-2 w-full border-b border-zinc-800 p-4 lg:order-1 lg:w-96 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Kuźnia pętli</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Ustaw punkt startu (GPS, wyszukiwarka lub mapa), wybierz dystans i
            kierunek — reszta dzieje się automatycznie.
          </p>
        </div>

        <RouteForm
          values={form}
          loading={loading}
          pickOnMap={pickOnMap}
          locationStatus={locationMode}
          onChange={handleFormChange}
          onSubmit={handleGenerate}
          onUseMyLocation={handleUseMyLocation}
          onTogglePickOnMap={() => setPickOnMap((active) => !active)}
        />

        {error ? (
          <p className="mt-4 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        {route ? (
          <section className="mt-6 space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-200">Metryki</h2>
              <Link
                href={`/routes/${route.id}`}
                className="text-xs text-emerald-400 hover:underline"
              >
                Szczegóły →
              </Link>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-zinc-500">
                  {(route.approachEnabled ?? false) ||
                  route.metrics.approachDistanceKm != null
                    ? "Razem"
                    : "Dystans"}
                </dt>
                <dd>{route.metrics.distanceKm.toFixed(1)} km</dd>
              </div>
              {((route.approachEnabled ?? false) ||
                route.metrics.approachDistanceKm != null) &&
              route.metrics.loopDistanceKm != null &&
              route.metrics.approachDistanceKm != null ? (
                <>
                  <div>
                    <dt className="text-zinc-500">Pętla</dt>
                    <dd>{route.metrics.loopDistanceKm.toFixed(1)} km</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Dojazd</dt>
                    <dd>{route.metrics.approachDistanceKm.toFixed(1)} km</dd>
                  </div>
                </>
              ) : null}
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

            <SurfaceBreakdown breakdown={route.metrics.surfaceBreakdown} />

            <div>
              <label
                htmlFor="notes"
                className="mb-1 block text-xs font-medium text-zinc-400"
              >
                Notatka (opcjonalnie)
              </label>
              <textarea
                id="notes"
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="np. za dużo szosy na początku…"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex gap-2">
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
    </main>
  );
}
