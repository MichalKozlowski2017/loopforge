"use client";

import type { RouteGenerationQuality } from "@loopforge/osm-types";

interface RouteFallbackDialogProps {
  quality: RouteGenerationQuality;
  onDismiss: () => void;
}

export function RouteFallbackDialog({
  quality,
  onDismiss,
}: RouteFallbackDialogProps) {
  const title =
    quality.mode === "fallback"
      ? "Pętla kompromisowa"
      : "Pętla z luźniejszymi kryteriami";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fallback-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl border border-amber-900/50 bg-zinc-950 p-5 shadow-2xl">
        <h2
          id="fallback-dialog-title"
          className="text-base font-medium text-amber-200"
        >
          {title}
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          Udało się ułożyć trasę, ale nie spełnia w pełni Twoich ustawień.
          Sprawdź mapę przed wyjazdem.
        </p>
        <ul className="mt-3 space-y-2 text-sm text-zinc-400">
          {quality.warnings.map((warning) => (
            <li key={warning} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
        {quality.requestedDistanceKm != null &&
        quality.actualDistanceKm != null ? (
          <p className="mt-4 text-xs text-zinc-500">
            Plan: ~{quality.requestedDistanceKm} km · wynik:{" "}
            {quality.actualDistanceKm.toFixed(1)} km
          </p>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          className="mt-5 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-amber-400"
        >
          Rozumiem — pokaż na mapie
        </button>
      </div>
    </div>
  );
}
