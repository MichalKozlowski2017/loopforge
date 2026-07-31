"use client";

import type { StoredRoute } from "@loopforge/osm-types";

const LABELS = ["A", "B", "C"] as const;

interface RouteVariantPickerProps {
  variants: StoredRoute[];
  selectedId: string;
  onSelect: (route: StoredRoute) => void;
  onConfirm: (route: StoredRoute) => void;
}

export function RouteVariantPicker({
  variants,
  selectedId,
  onSelect,
  onConfirm,
}: RouteVariantPickerProps) {
  const selected =
    variants.find((route) => route.id === selectedId) ?? variants[0];

  if (!selected || variants.length < 2) return null;

  return (
    <section className="mt-4 space-y-3 rounded-xl border border-amber-800/35 bg-amber-950/20 p-4">
      <div>
        <h2 className="text-sm font-medium text-amber-100">
          Wybierz wariant pętli
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          Wygenerowano {variants.length} różne trasy — porównaj i zatwierdź
          jedną.
        </p>
      </div>

      <div className="grid gap-2">
        {variants.map((route, index) => {
          const active = route.id === selected.id;
          const label = LABELS[index] ?? `${index + 1}`;
          return (
            <button
              key={route.id}
              type="button"
              onClick={() => onSelect(route)}
              className={`rounded-lg border px-3 py-2.5 text-left transition ${
                active
                  ? "border-amber-500 bg-amber-500/15 text-amber-50"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-700/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Wariant {label}</span>
                <span className="text-xs text-zinc-400">
                  score {route.metrics.score}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-400">
                {route.metrics.distanceKm.toFixed(1)} km · ~
                {route.metrics.elevationGainM} m ↑
              </p>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onConfirm(selected)}
        className="w-full rounded-lg bg-linear-to-r from-amber-700 via-orange-600 to-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-orange-950/25 transition hover:from-amber-600 hover:via-orange-500 hover:to-amber-400"
      >
        Użyj wariantu {LABELS[variants.indexOf(selected)] ?? ""}
      </button>
    </section>
  );
}
