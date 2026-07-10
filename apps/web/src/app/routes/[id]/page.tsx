"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { StoredRoute } from "@loopforge/osm-types";
import { SurfaceBreakdown } from "@/components/SurfaceBreakdown";
import { SurfaceLegend } from "@/components/SurfaceLegend";

const MapView = dynamic(
  () => import("@/components/MapView").then((mod) => mod.MapView),
  { ssr: false },
);

export default function RouteDetailPage() {
  const params = useParams<{ id: string }>();
  const [route, setRoute] = useState<StoredRoute | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/routes/${params.id}`)
      .then((response) => {
        if (!response.ok) throw new Error("Nie znaleziono trasy");
        return response.json();
      })
      .then((data: StoredRoute) => setRoute(data))
      .catch((err: Error) => setError(err.message));
  }, [params.id]);

  if (error) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-6">
        <p className="text-red-300">{error}</p>
        <Link href="/routes" className="mt-4 text-sm text-emerald-400 hover:underline">
          ← Historia
        </Link>
      </main>
    );
  }

  if (!route) {
    return (
      <main className="flex flex-1 items-center justify-center text-zinc-500">
        Ładowanie…
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="w-full space-y-4 border-b border-zinc-800 p-6 lg:w-96 lg:border-b-0 lg:border-r">
        <Link href="/routes" className="text-sm text-emerald-400 hover:underline">
          ← Historia
        </Link>
        <div>
          <h1 className="text-xl font-semibold capitalize">
            {route.bikeType} · {route.metrics.distanceKm.toFixed(1)} km
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {route.direction} · {new Date(route.createdAt).toLocaleString("pl-PL")}
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
        {route.notes ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
            {route.notes}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Link
            href={`/?routeId=${route.id}`}
            className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-center text-sm hover:border-zinc-500"
          >
            Otwórz w generatorze
          </Link>
          <a
            href={`/api/routes/${route.id}/gpx`}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:border-zinc-500"
          >
            GPX
          </a>
        </div>
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
