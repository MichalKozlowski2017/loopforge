"use client";

import Link from "next/link";
import { getRideProfileLabel } from "@loopforge/osm-types";
import { RouteShapeThumb } from "@/components/RouteShapeThumb";
import type { CloudRouteSummary } from "@/lib/cloud-routes-store";

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

export function RouteSummaryList({ routes }: { routes: CloudRouteSummary[] }) {
  return (
    <ul className="space-y-3">
      {routes.map((route) => (
        <li key={route.id}>
          <div className="rounded-xl border border-amber-950/25 bg-zinc-900/50 p-3 transition hover:border-amber-700/35 sm:p-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <Link
                href={`/routes/${route.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4"
              >
                <RouteShapeThumb
                  path={route.previewPath}
                  className="h-16 w-16 text-amber-400 sm:h-20 sm:w-20"
                  label={`Kształt pętli ${BIKE_LABELS[route.bikeType]} ${route.distanceKm.toFixed(0)} km`}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-zinc-100">
                    {route.isFavorite ? (
                      <span className="mr-1.5 text-amber-300" aria-label="Ulubiona">
                        ★
                      </span>
                    ) : null}
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
                    <p className="mt-2 line-clamp-2 text-sm text-zinc-400 italic">
                      „{route.notes}&rdquo;
                    </p>
                  ) : null}
                </div>
              </Link>
              <div className="shrink-0 self-start pt-0.5 text-right">
                {route.rating != null ? (
                  <Link
                    href={`/routes/${route.id}#feedback`}
                    className="text-sm font-medium text-amber-200 hover:underline"
                  >
                    {route.rating}/5
                  </Link>
                ) : (
                  <Link
                    href={`/routes/${route.id}#feedback`}
                    className="rounded-lg border border-amber-700/40 px-2.5 py-1 text-xs text-amber-100 transition hover:bg-amber-500/10"
                  >
                    Oceń
                  </Link>
                )}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
