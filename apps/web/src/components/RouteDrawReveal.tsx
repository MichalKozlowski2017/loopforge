"use client";

import { useEffect, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import {
  type LngLat,
  revealDurationMs,
  slicePathByProgress,
} from "@/lib/route-draw-path";

interface RouteDrawRevealProps {
  map: maplibregl.Map;
  coordinates: LngLat[];
  active: boolean;
  onDrawingComplete?: () => void;
  onComplete: () => void;
}

interface ScreenPoint {
  x: number;
  y: number;
}

function pathToD(points: ScreenPoint[]): string {
  if (points.length === 0) return "";
  return points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join(" ");
}

export function RouteDrawReveal({
  map,
  coordinates,
  active,
  onDrawingComplete,
  onComplete,
}: RouteDrawRevealProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [maskOpacity, setMaskOpacity] = useState(1);
  const [threadOpacity, setThreadOpacity] = useState(1);
  const [screenPath, setScreenPath] = useState<ScreenPoint[]>([]);
  const [tip, setTip] = useState<ScreenPoint | null>(null);
  const phaseRef = useRef<"idle" | "drawing" | "unveiling">("idle");
  const completedRef = useRef(false);

  useEffect(() => {
    if (!active || coordinates.length < 2) {
      phaseRef.current = "idle";
      setProgress(0);
      setMaskOpacity(1);
      setThreadOpacity(1);
      setScreenPath([]);
      setTip(null);
      completedRef.current = false;
      return;
    }

    phaseRef.current = "drawing";
    completedRef.current = false;
    setProgress(0);
    setMaskOpacity(1);
    setThreadOpacity(1);

    map.dragPan.disable();
    map.scrollZoom.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    map.touchZoomRotate.disable();

    const durationMs = revealDurationMs(coordinates);
    const start = performance.now();
    let frameId = 0;
    let unveilStart = 0;
    const unveilMs = 780;

    const projectPath = (path: LngLat[]) => {
      const projected = path.map(([lng, lat]) => {
        const point = map.project([lng, lat]);
        return { x: point.x, y: point.y };
      });
      setScreenPath(projected);
    };

    const frame = (now: number) => {
      if (phaseRef.current === "drawing") {
        const t = Math.max(0, Math.min(1, (now - start) / durationMs));
        const eased = 1 - (1 - t) ** 2.2;
        setProgress(eased);

        const { path, tip: tipCoord } = slicePathByProgress(coordinates, eased);
        projectPath(path);
        if (tipCoord) {
          const p = map.project(tipCoord);
          setTip({ x: p.x, y: p.y });
        }

        if (t >= 1) {
          phaseRef.current = "unveiling";
          unveilStart = now;
          onDrawingComplete?.();
        }
        frameId = requestAnimationFrame(frame);
        return;
      }

      if (phaseRef.current === "unveiling") {
        const t = Math.max(0, Math.min(1, (now - unveilStart) / unveilMs));
        const eased = t * t * (3 - 2 * t);
        setMaskOpacity(1 - eased);
        setThreadOpacity(Math.max(0, 1 - eased * 1.4));

        if (t >= 1) {
          phaseRef.current = "idle";
          if (!completedRef.current) {
            completedRef.current = true;
            onComplete();
          }
          return;
        }
        frameId = requestAnimationFrame(frame);
      }
    };

    frameId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(frameId);
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.doubleClickZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
      map.touchZoomRotate.enable();
    };
  }, [active, coordinates, map, onComplete, onDrawingComplete]);

  if (!active || coordinates.length < 2) return null;

  const pathD = pathToD(screenPath);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-xl"
      aria-hidden
    >
      <div
        className="absolute inset-0 bg-zinc-950 transition-none"
        style={{ opacity: maskOpacity }}
      />

      <svg className="absolute inset-0 h-full w-full" style={{ opacity: threadOpacity }}>
        <defs>
          <filter id="route-draw-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="route-draw-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="55%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
        </defs>

        {pathD ? (
          <>
            <path
              d={pathD}
              fill="none"
              stroke="url(#route-draw-gradient)"
              strokeWidth={10}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.55}
              filter="url(#route-draw-glow)"
            />
            <path
              d={pathD}
              fill="none"
              stroke="#fef3c7"
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.95}
            />
          </>
        ) : null}

        {tip ? (
          <g transform={`translate(${tip.x} ${tip.y})`}>
            <circle r={14} fill="#f97316" opacity={0.25} filter="url(#route-draw-glow)" />
            <circle r={6} fill="#fbbf24" />
            <circle r={2.5} fill="#fff7ed" />
            <circle r={2} className="fill-amber-300 route-draw-spark route-draw-spark-a" />
            <circle r={1.6} className="fill-yellow-200 route-draw-spark route-draw-spark-b" />
            <circle r={1.8} className="fill-orange-400 route-draw-spark route-draw-spark-c" />
            <circle r={1.4} className="fill-amber-400 route-draw-spark route-draw-spark-d" />
          </g>
        ) : null}
      </svg>

      <div
        className="absolute inset-x-0 bottom-4 flex justify-center"
        style={{ opacity: Math.max(0, 1 - progress * 1.4) * maskOpacity }}
      >
        <span className="rounded-full border border-amber-500/30 bg-zinc-950/90 px-3 py-1 text-xs font-medium text-amber-200/90">
          Wykuwamy nitkę trasy…
        </span>
      </div>
    </div>
  );
}
