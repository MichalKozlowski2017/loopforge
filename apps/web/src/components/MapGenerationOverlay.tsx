"use client";

import type { RouteGenerationPhase, RouteGenerationProgress } from "@loopforge/osm-types";

const PHASE_STEPS: { phase: RouteGenerationPhase; title: string }[] = [
  { phase: "planning", title: "Planuję kształt pętli" },
  { phase: "variants", title: "Losuję warianty" },
  { phase: "routing", title: "BRouter liczy trasy" },
  { phase: "scoring", title: "Porównuję warianty" },
  { phase: "refining", title: "Dopasowuję dystans" },
  { phase: "finalizing", title: "Spinam GPX" },
];

function phaseIndex(phase: RouteGenerationPhase): number {
  const index = PHASE_STEPS.findIndex((step) => step.phase === phase);
  return index >= 0 ? index : 0;
}

interface MapGenerationOverlayProps {
  seconds: number;
  progress: RouteGenerationProgress | null;
}

export function MapGenerationOverlay({
  seconds,
  progress,
}: MapGenerationOverlayProps) {
  const activeIndex = progress ? phaseIndex(progress.phase) : 0;
  const barPercent = progress?.progress ?? 4;
  const subtitle = progress?.detail ?? progress?.message ?? "Startuję…";
  const showSlowHint =
    seconds >= 15 || (progress?.phase === "routing" && progress.progress > 30);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-zinc-950/75 p-6 backdrop-blur-md"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        <div className="relative h-44 w-44">
          <div className="absolute inset-0 rounded-full bg-emerald-500/10 blur-2xl loopforge-glow" />
          <svg
            viewBox="0 0 200 200"
            className="relative h-full w-full"
            aria-hidden
          >
            <circle
              cx="100"
              cy="100"
              r="78"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-zinc-700/80"
            />
            <path
              d="M 100 28
                 C 148 32, 168 72, 162 100
                 C 156 132, 128 158, 100 172
                 C 68 158, 42 128, 38 100
                 C 34 68, 58 32, 100 28 Z"
              fill="none"
              stroke="url(#loopforgeStroke)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="loopforge-route-draw"
            />
            <circle
              cx="100"
              cy="28"
              r="5"
              className="fill-emerald-400 loopforge-start-pulse"
            />
            <defs>
              <linearGradient
                id="loopforgeStroke"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="55%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>
            </defs>
          </svg>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-2xl font-semibold tabular-nums text-emerald-300">
              {seconds}s
            </span>
          </div>
        </div>

        <div className="w-full space-y-4">
          <div className="space-y-1 text-center">
            <p className="text-lg font-medium text-zinc-100">
              {progress?.message ?? "Kuźnia pracuje…"}
            </p>
            <p className="text-sm text-zinc-400">{subtitle}</p>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-linear-to-r from-emerald-600 to-emerald-400 transition-[width] duration-500 ease-out"
              style={{ width: `${barPercent}%` }}
            />
          </div>

          <ol className="space-y-2">
            {PHASE_STEPS.map((step, index) => {
              const done = index < activeIndex;
              const active = index === activeIndex;
              return (
                <li
                  key={step.phase}
                  className={`flex items-start gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-emerald-950/50 text-emerald-100"
                      : done
                        ? "text-zinc-500"
                        : "text-zinc-600"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                      done
                        ? "bg-emerald-600/30 text-emerald-400"
                        : active
                          ? "bg-emerald-500/20 text-emerald-300 loopforge-step-pulse"
                          : "bg-zinc-800 text-zinc-600"
                    }`}
                    aria-hidden
                  >
                    {done ? "✓" : active ? "●" : "○"}
                  </span>
                  <span>
                    <span className={active ? "font-medium" : undefined}>
                      {step.title}
                    </span>
                    {active && progress?.detail ? (
                      <span className="mt-0.5 block text-xs text-zinc-400">
                        {progress.detail}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>

          {showSlowHint ? (
            <p className="text-center text-xs text-zinc-500">
              Pierwsze uruchomienie po przerwie może potrwać do minuty — BRouter
              buduje trasę od zera.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
