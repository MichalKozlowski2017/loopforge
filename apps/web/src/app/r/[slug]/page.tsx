"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getRideProfileLabel } from "@loopforge/osm-types";
import { SurfaceBreakdown } from "@/components/SurfaceBreakdown";
import { SurfaceLegend } from "@/components/SurfaceLegend";
import type { SharedRoutePublic } from "@/lib/cloud-routes-store";
import { downloadRouteGpx } from "@/lib/download-route-gpx";

const MapView = dynamic(
  () => import("@/components/MapView").then((mod) => mod.MapView),
  { ssr: false },
);

const BIKE_LABELS: Record<SharedRoutePublic["bikeType"], string> = {
  gravel: "Gravel",
  road: "Szosa",
  mtb: "MTB",
  general: "Ogólny",
};

export default function SharedRoutePage() {
  const params = useParams<{ slug: string }>();
  const [route, setRoute] = useState<SharedRoutePublic | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/share/${params.slug}`);
        const payload = (await response.json().catch(() => null)) as {
          route?: SharedRoutePublic;
          error?: string;
        } | null;
        if (!cancelled) {
          if (!response.ok || !payload?.route) {
            setError(payload?.error ?? "Nie znaleziono udostępnionej trasy.");
            setRoute(null);
          } else {
            setRoute(payload.route);
            setError(null);
          }
          setReady(true);
        }
      } catch {
        if (!cancelled) {
          setError("Nie udało się pobrać trasy.");
          setRoute(null);
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.slug]);

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center text-zinc-500">
        Ładowanie…
      </main>
    );
  }

  if (!route || error) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-6">
        <p className="text-zinc-400">
          {error ?? "Nie znaleziono udostępnionej trasy."}
        </p>
        <Link href="/" className="mt-4 text-sm text-amber-400 hover:underline">
          → Wygeneruj własną pętlę
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="w-full space-y-4 border-b border-amber-950/30 p-6 lg:w-96 lg:border-b-0 lg:border-r lg:overflow-y-auto">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          Udostępniona pętla
        </p>
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">
            {BIKE_LABELS[route.bikeType]} · {route.metrics.distanceKm.toFixed(1)}{" "}
            km
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {route.direction}
            {route.profile
              ? ` · ${getRideProfileLabel(route.bikeType, route.profile) ?? route.profile}`
              : ""}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-zinc-500">Przewyższenie</dt>
            <dd>~{route.metrics.elevationGainM} m</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Score</dt>
            <dd>{(route.metrics.score * 100).toFixed(0)}%</dd>
          </div>
        </dl>
        <SurfaceBreakdown breakdown={route.metrics.surfaceBreakdown} />
        <button
          type="button"
          onClick={() =>
            downloadRouteGpx({
              id: route.id,
              bikeType: route.bikeType,
              direction: route.direction,
              profile: route.profile,
              start: route.start,
              geojson: route.geojson,
              mapGeojson: route.mapGeojson,
              metrics: route.metrics,
              gpx: route.gpx,
              createdAt: route.createdAt,
              shareSlug: route.shareSlug,
            })
          }
          className="w-full rounded-lg border border-amber-700/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 transition hover:bg-amber-500/20"
        >
          Pobierz GPX
        </button>
        <Link
          href="/"
          className="block text-center text-sm text-zinc-400 transition hover:text-amber-200"
        >
          Wygeneruj własną pętlę w Loopforge →
        </Link>
      </aside>
      <section className="relative min-h-[50vh] flex-1 p-4 lg:min-h-0">
        <MapView
          center={[route.start.lng, route.start.lat]}
          start={route.start}
          route={route.geojson}
          mapGeojson={route.mapGeojson ?? null}
        />
        {route.mapGeojson ? <SurfaceLegend /> : null}
      </section>
    </main>
  );
}
