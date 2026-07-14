"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { downloadRouteGpx } from "@/lib/download-route-gpx";
import {
  getLocalRouteById,
  saveLocalRoute,
  updateLocalRouteRating,
} from "@/lib/local-routes-store";
import { validateViaPointsForRoute } from "@loopforge/generator/via-validation";

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
  viaPoints: [],
  ...FALLBACK_START,
};

export default function HomePage() {
  const searchParams = useSearchParams();
  const routeIdFromUrl = searchParams.get("routeId");

  const [form, setForm] = useState<RouteFormValues>(DEFAULT_FORM);
  const [route, setRoute] = useState<StoredRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [overlayExiting, setOverlayExiting] = useState(false);
  const [routeRevealActive, setRouteRevealActive] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [generationProgress, setGenerationProgress] =
    useState<RouteGenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [pickOnMap, setPickOnMap] = useState(false);
  const mapSectionRef = useRef<HTMLElement>(null);
  const loopEntry = useMemo(() => extractLoopEntry(route), [route]);
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

    const data = getLocalRouteById(routeIdFromUrl);
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
      avoidAsphalt:
        data.avoidAsphalt ??
        (data.bikeType === "mtb" || data.bikeType === "gravel"),
      approachEnabled: data.approachEnabled ?? false,
      approachDistanceKm: data.approachDistanceKm ?? 10,
      viaPoints: data.viaPoints ?? [],
      lat: data.start.lat,
      lng: data.start.lng,
    });
    setLocationMode("manual");
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
    const lockScroll = loading || overlayExiting || routeRevealActive;
    if (!lockScroll) return;

    const isMobile = window.matchMedia("(max-width: 1023px)").matches;
    // On mobile allow scrolling during route-draw reveal (map already snapped on generate).
    if (isMobile && routeRevealActive && !loading && !overlayExiting) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [loading, overlayExiting, routeRevealActive]);

  function scrollMobileToMap() {
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    window.scrollTo({ top: 0, behavior: "auto" });
    mapSectionRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }

  const handleOverlayExitComplete = useCallback(() => {
    setLoading(false);
    setOverlayExiting(false);
    setRouteRevealActive(true);
  }, []);

  const handleRouteRevealComplete = useCallback(() => {
    setRouteRevealActive(false);
  }, []);

  async function handleGenerate() {
    scrollMobileToMap();
    setLoading(true);
    setOverlayExiting(false);
    setRouteRevealActive(false);
    setLoadingSeconds(0);
    setGenerationProgress(null);
    setError(null);
    setPickOnMap(false);
    setRoute(null);

    const tick = window.setInterval(() => {
      setLoadingSeconds((seconds) => seconds + 1);
    }, 1000);

    try {
      const request = {
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
        viaPoints:
          form.viaPoints.length > 0
            ? form.viaPoints.filter(
                (p) =>
                  Number.isFinite(p.lat) &&
                  Number.isFinite(p.lng) &&
                  !(Math.abs(p.lat) < 0.0001 && Math.abs(p.lng) < 0.0001),
              )
            : undefined,
      };

      if (request.viaPoints?.length) {
        const viaCheck = validateViaPointsForRoute(
          {
            start: request.start,
            direction: request.direction,
            distanceKm: request.distanceKm,
            approachEnabled: request.approachEnabled,
            approachDistanceKm: request.approachDistanceKm,
          },
          request.viaPoints,
        );
        if (!viaCheck.ok) {
          setError(viaCheck.message ?? "Nieprawidłowe punkty przejazdu.");
          return;
        }
      }

      const response = await fetch("/api/routes/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(120_000),
      });

      const generated = await consumeGenerationStream(response, (progress) => {
        setGenerationProgress(progress);
      });
      saveLocalRoute(generated);
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
      setOverlayExiting(true);
    }
  }

  function handleRate(rating: "up" | "down") {
    if (!route) return;

    const updated = updateLocalRouteRating(route.id, rating, notes);
    if (updated) setRoute(updated);
  }

  const mapVeiled = loading || overlayExiting || routeRevealActive;

  return (
    <main className="flex flex-col lg:min-h-0 lg:h-full lg:flex-1 lg:flex-row lg:overflow-hidden">
      <section
        ref={mapSectionRef}
        className="relative order-1 h-[min(46vh,26rem)] min-h-[240px] shrink-0 scroll-mt-3 p-3 lg:order-2 lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-1 lg:p-4"
      >
        <MapView
          center={[form.lng, form.lat]}
          start={{ lat: form.lat, lng: form.lng }}
          route={route?.geojson ?? null}
          mapGeojson={route?.mapGeojson ?? null}
          pickStart={pickOnMap && !loading && !overlayExiting && !routeRevealActive}
          onStartChange={handleStartChange}
          loopEntry={loopEntry}
          approachEnabled={Boolean(route?.approachEnabled ?? form.approachEnabled)}
          approachDistanceKm={route?.metrics.approachDistanceKm ?? null}
          returnApproachDistanceKm={route?.metrics.returnApproachKm ?? null}
          mapVeiled={mapVeiled}
          routeRevealActive={routeRevealActive}
          onRouteRevealComplete={handleRouteRevealComplete}
          viaPoints={
            route?.viaPoints?.length
              ? route.viaPoints
              : form.viaPoints.filter(
                  (p) =>
                    Number.isFinite(p.lat) &&
                    Number.isFinite(p.lng) &&
                    !(Math.abs(p.lat) < 0.0001 && Math.abs(p.lng) < 0.0001),
                )
          }
        />
        {loading || overlayExiting ? (
          <MapGenerationOverlay
            seconds={loadingSeconds}
            progress={generationProgress}
            showApproach={form.approachEnabled}
            exiting={overlayExiting}
            onExitComplete={handleOverlayExitComplete}
          />
        ) : null}
        {route?.mapGeojson && !mapVeiled ? <SurfaceLegend /> : null}
      </section>

      <aside className="scrollbar-hidden order-2 w-full border-b border-amber-950/30 p-4 lg:order-1 lg:h-full lg:min-h-0 lg:w-96 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-6">
        <div className="mb-6">
          <p className="text-sm text-zinc-400">
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
          <section className="mt-6 space-y-4 rounded-xl border border-amber-950/30 bg-zinc-900/60 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-200">Metryki</h2>
              <Link
                href={`/routes/${route.id}`}
                className="text-xs text-amber-400 hover:underline"
              >
                Szczegóły →
              </Link>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-zinc-500">
                  {(route.approachEnabled ?? false) ||
                  route.metrics.approachDistanceKm != null
                    ? "Cały wyjazd"
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
                    <dt className="text-zinc-500">Pętla (GPX)</dt>
                    <dd>{route.metrics.loopDistanceKm.toFixed(1)} km</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Dojazd</dt>
                    <dd>{route.metrics.approachDistanceKm.toFixed(1)} km</dd>
                  </div>
                  {route.metrics.returnApproachKm != null ? (
                    <div>
                      <dt className="text-zinc-500">Powrót</dt>
                      <dd>{route.metrics.returnApproachKm.toFixed(1)} km</dd>
                    </div>
                  ) : null}
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
              <button
                type="button"
                onClick={() => downloadRouteGpx(route)}
                className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-center text-sm transition hover:border-amber-700/40 hover:text-amber-100"
              >
                Pobierz GPX
              </button>
              <button
                type="button"
                onClick={() => handleRate("up")}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  route.rating === "up"
                    ? "border-amber-500 text-amber-300"
                    : "border-zinc-700 hover:border-amber-700/40 hover:text-amber-100"
                }`}
              >
                👍
              </button>
              <button
                type="button"
                onClick={() => handleRate("down")}
                className={`rounded-lg border px-3 py-2 text-sm transition ${
                  route.rating === "down"
                    ? "border-red-500 text-red-300"
                    : "border-zinc-700 hover:border-amber-700/40 hover:text-amber-100"
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
