"use client";

import { useEffect, useRef } from "react";
import type { RouteGenerationProgress } from "@loopforge/osm-types";
import { ForgeLoaderAnimation } from "@/components/ForgeLoaderAnimation";
import { ForgeEmberField } from "@/components/ForgeEmberField";
import { ForgeFireBackground } from "@/components/ForgeFireBackground";

interface MapGenerationOverlayProps {
  seconds: number;
  progress: RouteGenerationProgress | null;
  showApproach?: boolean;
  exiting?: boolean;
  onExitComplete?: () => void;
}

const APPROACH_STEP = {
  phase: "approach" as const,
  title: "Prolog przed pętlą",
};

function buildPhaseSteps(showApproach: boolean) {
  const steps = [
    { phase: "planning" as const, title: "Szkic obwodu" },
    ...(showApproach ? [APPROACH_STEP] : []),
    { phase: "variants" as const, title: "Kucie wariantów" },
    { phase: "routing" as const, title: "Wykuwanie nitki" },
    { phase: "scoring" as const, title: "Test na obwodzie" },
    { phase: "refining" as const, title: "Docinanie kilometrów" },
    { phase: "finalizing" as const, title: "Satyna i GPX" },
  ];
  return steps;
}

export function MapGenerationOverlay({
  seconds,
  progress,
  showApproach = false,
  exiting = false,
  onExitComplete,
}: MapGenerationOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const phaseSteps = buildPhaseSteps(showApproach);
  const activeIndex = progress
    ? phaseSteps.findIndex((step) => step.phase === progress.phase)
    : 0;
  const safeActiveIndex = activeIndex >= 0 ? activeIndex : 0;
  const barPercent = progress?.progress ?? 4;
  const subtitle =
    progress?.detail ??
    (progress ? "" : "Rozpalamy kuźnię — zaraz zaczniemy kuć obwód…");
  const showSlowHint =
    seconds >= 15 || (progress?.phase === "routing" && progress.progress > 30);

  useEffect(() => {
    if (!exiting) return;
    const panel = panelRef.current;

    const finish = () => onExitComplete?.();

    const timeoutId = window.setTimeout(finish, 760);

    if (!panel) {
      return () => window.clearTimeout(timeoutId);
    }

    const handleEnd = (event: AnimationEvent) => {
      if (event.target !== panel) return;
      window.clearTimeout(timeoutId);
      finish();
    };

    panel.addEventListener("animationend", handleEnd);
    return () => {
      window.clearTimeout(timeoutId);
      panel.removeEventListener("animationend", handleEnd);
    };
  }, [exiting, onExitComplete]);

  return (
    <div
      className={`fixed inset-0 z-60 flex items-center justify-center overflow-y-auto bg-zinc-950 p-4 sm:p-6 ${
        exiting
          ? "loopforge-overlay-backdrop-exit"
          : "loopforge-overlay-backdrop"
      }`}
      role="status"
      aria-live="polite"
      aria-busy={!exiting}
    >
      <ForgeFireBackground />
      <div className="pointer-events-none absolute inset-0 z-[1]">
        <ForgeEmberField />
      </div>

      <div
        ref={panelRef}
        className={`relative z-10 flex w-full max-w-md flex-col items-center gap-6 py-4 sm:gap-8 sm:py-0 ${
          exiting
            ? "loopforge-overlay-panel-exit"
            : "loopforge-overlay-panel"
        }`}
      >
        <div className="loopforge-overlay-item loopforge-overlay-item-1">
          <ForgeLoaderAnimation
            seconds={seconds}
            progressPercent={progress?.progress ?? 0}
          />
        </div>

        <div className="loopforge-overlay-item loopforge-overlay-item-2 w-full space-y-4">
          <div className="min-h-[4.75rem] space-y-1 text-center">
            <p className="line-clamp-2 text-lg font-medium leading-snug text-zinc-100">
              {progress?.message ?? "Kuźnia pracuje…"}
            </p>
            <p className="line-clamp-2 min-h-[2.5rem] text-sm leading-snug text-zinc-400">
              {subtitle}
            </p>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-linear-to-r from-amber-700 via-orange-500 to-amber-400 transition-[width] duration-500 ease-out"
              style={{ width: `${barPercent}%` }}
            />
          </div>

          <ol className="max-h-[38vh] space-y-2 overflow-y-auto pr-1 sm:max-h-none sm:overflow-visible">
            {phaseSteps.map((step, index) => {
              const done = index < safeActiveIndex;
              const active = index === safeActiveIndex;
              return (
                <li
                  key={step.phase}
                  className={`flex min-h-[2.5rem] items-start gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-amber-950/40 text-amber-100"
                      : done
                        ? "text-zinc-500"
                        : "text-zinc-600"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                      done
                        ? "bg-amber-600/30 text-amber-400"
                        : active
                          ? "bg-amber-500/25 text-amber-300 loopforge-step-pulse"
                          : "bg-zinc-800 text-zinc-600"
                    }`}
                    aria-hidden
                  >
                    {done ? "✓" : active ? "●" : "○"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={active ? "font-medium" : undefined}>
                      {step.title}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>

          <p
            className={`min-h-[2.5rem] text-center text-xs leading-snug text-zinc-500 ${
              showSlowHint ? "" : "invisible"
            }`}
          >
            Pierwsze odpalenie po przerwie może potrwać do minuty — kuźnia
            nagrzewa się od zera.
          </p>
        </div>
      </div>
    </div>
  );
}
