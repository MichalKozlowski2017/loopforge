"use client";

import type { RouteViaPoint } from "@loopforge/osm-types";
import {
  MAX_VIA_POINTS,
  validateViaPointForRoute,
  type ViaPointRouteContext,
  type ViaPointStatus,
} from "@loopforge/generator/via-validation";
import { LocationSearch } from "@/components/LocationSearch";

interface ViaPointsEditorProps {
  viaPoints: RouteViaPoint[];
  routeRequest: ViaPointRouteContext;
  onChange: (points: RouteViaPoint[]) => void;
}

const STATUS_STYLES: Record<
  ViaPointStatus,
  { border: string; text: string; badge: string }
> = {
  ok: {
    border: "border-zinc-700",
    text: "text-zinc-500",
    badge: "bg-amber-500/15 text-amber-300",
  },
  warn: {
    border: "border-amber-600/50",
    text: "text-amber-400/90",
    badge: "bg-amber-500/15 text-amber-300",
  },
  error: {
    border: "border-red-600/50",
    text: "text-red-400/90",
    badge: "bg-red-500/15 text-red-300",
  },
};

export function ViaPointsEditor({
  viaPoints,
  routeRequest,
  onChange,
}: ViaPointsEditorProps) {
  function addPoint() {
    if (viaPoints.length >= MAX_VIA_POINTS) return;
    onChange([
      ...viaPoints,
      { lat: 0, lng: 0, label: "" },
    ]);
  }

  function updatePoint(index: number, patch: Partial<RouteViaPoint>) {
    onChange(
      viaPoints.map((point, i) => (i === index ? { ...point, ...patch } : point)),
    );
  }

  function removePoint(index: number) {
    onChange(viaPoints.filter((_, i) => i !== index));
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-zinc-300">
          Przejazd przez
        </label>
        <span className="text-xs text-zinc-500">
          max {MAX_VIA_POINTS} punkty
        </span>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Miejsca, które pętla ma obejść. Muszą leżeć w zasięgu i kierunku trasy
        (względem startu pętli, nie domu — przy włączonym dojeździe).
      </p>

      {viaPoints.length === 0 ? (
        <p className="mb-2 text-xs text-zinc-600">
          Brak punktów — generator sam wybierze trasę.
        </p>
      ) : null}

      <div className="space-y-3">
        {viaPoints.map((point, index) => {
          const validation = validateViaPointForRoute(
            routeRequest,
            point,
            point.label || `Punkt ${index + 1}`,
          );
          const styles = STATUS_STYLES[validation.status];

          return (
            <div
              key={`via-${index}-${point.lat}-${point.lng}`}
              className={`rounded-lg border bg-zinc-900/80 p-3 ${styles.border}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${styles.badge}`}
                >
                  {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removePoint(index)}
                  className="text-xs text-zinc-500 transition hover:text-red-400"
                >
                  Usuń
                </button>
              </div>

              <LocationSearch
                inputId={`via-search-${index}`}
                compact
                lat={point.lat}
                lng={point.lng}
                onSelect={(location) =>
                  updatePoint(index, {
                    lat: location.lat,
                    lng: location.lng,
                    label: location.label,
                  })
                }
              />

              <p className={`mt-2 text-[11px] ${styles.text}`}>
                {validation.message}
              </p>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addPoint}
        disabled={viaPoints.length >= MAX_VIA_POINTS}
        className="mt-3 w-full rounded-lg border border-dashed border-zinc-600 px-3 py-2 text-sm text-zinc-400 transition hover:border-amber-500/50 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Dodaj punkt na trasie
      </button>
    </div>
  );
}
