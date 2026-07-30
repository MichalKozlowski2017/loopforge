"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { StoredRoute } from "@loopforge/osm-types";
import { getRideProfileLabel } from "@loopforge/osm-types";
import { RouteFeedbackForm } from "@/components/RouteFeedbackForm";
import { SurfaceBreakdown } from "@/components/SurfaceBreakdown";
import { SurfaceLegend } from "@/components/SurfaceLegend";
import { downloadRouteGpx } from "@/lib/download-route-gpx";
import { feedbackTagLabel } from "@/lib/route-feedback";

const MapView = dynamic(
  () => import("@/components/MapView").then((mod) => mod.MapView),
  { ssr: false },
);

export default function RouteDetailPage() {
  const params = useParams<{ id: string }>();
  const [route, setRoute] = useState<StoredRoute | null>(null);
  const [ready, setReady] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/routes/${params.id}`);
        if (response.status === 401) {
          if (!cancelled) {
            setNeedsLogin(true);
            setReady(true);
          }
          return;
        }
        if (!response.ok) {
          if (!cancelled) {
            setRoute(null);
            setReady(true);
          }
          return;
        }
        const payload = (await response.json()) as { route?: StoredRoute };
        if (!cancelled) {
          setRoute(payload.route ?? null);
          setReady(true);
        }
      } catch {
        if (!cancelled) {
          setRoute(null);
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center text-zinc-500">
        Ładowanie…
      </main>
    );
  }

  if (needsLogin) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-6">
        <p className="text-zinc-400">Zaloguj się, żeby zobaczyć tę trasę.</p>
        <Link
          href={`/login?next=${encodeURIComponent(`/routes/${params.id}`)}`}
          className="mt-4 text-sm text-amber-400 hover:underline"
        >
          → Zaloguj się
        </Link>
      </main>
    );
  }

  if (!route) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-6">
        <p className="text-zinc-400">
          Trasa nie znaleziona na Twoim koncie. Wygeneruj nową pętlę albo sprawdź
          listę historii.
        </p>
        <Link href="/routes" className="mt-4 text-sm text-amber-400 hover:underline">
          ← Historia
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="w-full space-y-4 border-b border-amber-950/30 p-6 lg:w-96 lg:border-b-0 lg:border-r lg:overflow-y-auto">
        <Link href="/routes" className="text-sm text-amber-400 hover:underline">
          ← Historia
        </Link>
        <div>
          <h1 className="text-xl font-semibold capitalize">
            {route.bikeType} · {route.metrics.distanceKm.toFixed(1)} km
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {route.direction}
            {route.profile
              ? ` · ${getRideProfileLabel(route.bikeType, route.profile) ?? route.profile}`
              : ""}{" "}
            · {new Date(route.createdAt).toLocaleString("pl-PL")}
          </p>
          {route.rating != null ? (
            <p className="mt-2 text-sm text-amber-200">
              Ocena: {route.rating}/5
              {route.riddenAt
                ? ` · ${new Date(route.riddenAt).toLocaleDateString("pl-PL")}`
                : ""}
            </p>
          ) : null}
          {route.feedbackTags && route.feedbackTags.length > 0 ? (
            <p className="mt-1 text-xs text-zinc-500">
              {route.feedbackTags.map(feedbackTagLabel).join(" · ")}
            </p>
          ) : null}
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
        <RouteFeedbackForm
          routeId={route.id}
          initialRating={route.rating}
          initialTags={route.feedbackTags}
          initialNotes={route.notes}
          onSaved={setRoute}
        />
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
