"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { StoredRoute } from "@loopforge/osm-types";
import { SurfaceBreakdown } from "@/components/SurfaceBreakdown";
import { SurfaceLegend } from "@/components/SurfaceLegend";
import { downloadRouteGpx } from "@/lib/download-route-gpx";
import { getLocalRouteById } from "@/lib/local-routes-store";

const MapView = dynamic(
  () => import("@/components/MapView").then((mod) => mod.MapView),
  { ssr: false },
);

export default function RouteDetailPage() {
  const params = useParams<{ id: string }>();
  const [route, setRoute] = useState<StoredRoute | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setRoute(getLocalRouteById(params.id));
    setReady(true);
  }, [params.id]);

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center text-zinc-500">
        Ładowanie…
      </main>
    );
  }

  if (!route) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-6">
        <p className="text-zinc-400">
          Trasa nie znaleziona w tej przeglądarce. Wygeneruj ją ponownie lub
          otwórz link na urządzeniu, na którym ją utworzyłeś.
        </p>
        <Link href="/routes" className="mt-4 text-sm text-amber-400 hover:underline">
          ← Historia
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="w-full space-y-4 border-b border-amber-950/30 p-6 lg:w-96 lg:border-b-0 lg:border-r">
        <Link href="/routes" className="text-sm text-amber-400 hover:underline">
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
          <p className="rounded-lg border border-amber-950/25 bg-zinc-900/60 p-3 text-sm text-zinc-300">
            {route.notes}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Link
            href={`/?routeId=${route.id}`}
            className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-center text-sm transition hover:border-amber-700/40 hover:text-amber-100"
          >
            Otwórz w generatorze
          </Link>
          <button
            type="button"
            onClick={() => downloadRouteGpx(route)}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm transition hover:border-amber-700/40 hover:text-amber-100"
          >
            GPX
          </button>
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
