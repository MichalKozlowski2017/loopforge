"use client";

import { useEffect, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import {
  ROUTE_FIT_MAX_ZOOM,
  ROUTE_FIT_PADDING,
  boundsOf,
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

interface Spark {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

/** How far zoomed-out the camera starts before pushing in to the final fitted view. */
const ZOOM_PUSH_IN = 0.85;
const GRAVITY = 780;
const MAX_SPARKS = 240;

function pathToD(points: ScreenPoint[]): string {
  if (points.length === 0) return "";
  return points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join(" ");
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Camera-state-independent fit target — matches fitRouteToView exactly, but
 * derived purely from the coordinates so it self-heals if this effect ever
 * restarts mid-animation (it won't read a corrupted in-flight zoom/center).
 */
function computeFitCamera(
  map: maplibregl.Map,
  coords: LngLat[],
): { zoom: number; center: maplibregl.LngLat } | null {
  const bounds = boundsOf(coords);
  if (!bounds) return null;
  const camera = map.cameraForBounds(bounds, {
    padding: ROUTE_FIT_PADDING,
    maxZoom: ROUTE_FIT_MAX_ZOOM,
  });
  if (!camera || typeof camera.zoom !== "number" || !camera.center) return null;
  return { zoom: camera.zoom, center: camera.center as maplibregl.LngLat };
}

/** Cooling weld spark: white-hot -> yellow -> orange -> ember red as life drains. */
function sparkColor(lifeRatio: number): string {
  if (lifeRatio > 0.72) return "#fffbeb";
  if (lifeRatio > 0.48) return "#fde68a";
  if (lifeRatio > 0.24) return "#fb923c";
  return "#c2410c";
}

export function RouteDrawReveal({
  map,
  coordinates,
  active,
  onDrawingComplete,
  onComplete,
}: RouteDrawRevealProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const [progress, setProgress] = useState(0);
  const [maskOpacity, setMaskOpacity] = useState(1);
  const [threadOpacity, setThreadOpacity] = useState(1);
  const [screenPath, setScreenPath] = useState<ScreenPoint[]>([]);
  const [tip, setTip] = useState<ScreenPoint | null>(null);
  const phaseRef = useRef<"idle" | "drawing" | "unveiling">("idle");
  const completedRef = useRef(false);
  const sparksRef = useRef<Spark[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvasSizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      ctx?.scale(dpr, dpr);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active || coordinates.length < 2) {
      phaseRef.current = "idle";
      setProgress(0);
      setMaskOpacity(1);
      setThreadOpacity(1);
      setScreenPath([]);
      setTip(null);
      completedRef.current = false;
      sparksRef.current = [];
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d") ?? null;
      if (ctx) {
        const { width, height } = canvasSizeRef.current;
        ctx.clearRect(0, 0, width, height);
      }
      return;
    }

    phaseRef.current = "drawing";
    completedRef.current = false;
    setProgress(0);
    setMaskOpacity(1);
    setThreadOpacity(1);
    sparksRef.current = [];

    map.dragPan.disable();
    map.scrollZoom.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    map.touchZoomRotate.disable();

    const camera = computeFitCamera(map, coordinates);
    const finalZoom = camera?.zoom ?? map.getZoom();
    const finalCenter = camera?.center ?? map.getCenter();
    const startZoom = finalZoom - ZOOM_PUSH_IN;
    map.jumpTo({ zoom: startZoom, center: finalCenter });

    const durationMs = revealDurationMs(coordinates);
    const start = performance.now();
    let lastNow = start;
    let frameId = 0;
    let unveilStart = 0;
    const unveilMs = 780;
    let lastTip: ScreenPoint | null = null;

    const projectPath = (path: LngLat[]) => {
      const projected = path.map(([lng, lat]) => {
        const point = map.project([lng, lat]);
        return { x: point.x, y: point.y };
      });
      setScreenPath(projected);
    };

    const spawnSparks = (
      at: ScreenPoint,
      dirX: number,
      dirY: number,
      count: number,
    ) => {
      const sparks = sparksRef.current;
      const baseAngle = Math.atan2(-dirY, -dirX) || -Math.PI / 2;
      for (let i = 0; i < count; i++) {
        const spread = (Math.random() - 0.5) * 2.6;
        const angle = baseAngle + spread;
        const speed = 60 + Math.random() * 210;
        sparks.push({
          x: at.x,
          y: at.y,
          px: at.x,
          py: at.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 50,
          life: 1,
          maxLife: 240 + Math.random() * 380,
          size: 0.7 + Math.random() * 1.5,
        });
      }
      if (sparks.length > MAX_SPARKS) {
        sparks.splice(0, sparks.length - MAX_SPARKS);
      }
    };

    const drawSparks = (ctx: CanvasRenderingContext2D, dt: number) => {
      const { width, height } = canvasSizeRef.current;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      const sparks = sparksRef.current;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= dt / s.maxLife;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.px = s.x;
        s.py = s.y;
        s.vy += GRAVITY * (dt / 1000);
        s.vx *= 0.985;
        s.x += s.vx * (dt / 1000);
        s.y += s.vy * (dt / 1000);

        const alpha = Math.min(1, s.life * 1.7);
        ctx.strokeStyle = sparkColor(s.life);
        ctx.globalAlpha = alpha;
        ctx.lineWidth = Math.max(0.35, s.size * Math.max(0.35, s.life));
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(s.px, s.py);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };

    const frame = (now: number) => {
      const dt = Math.min(48, now - lastNow);
      lastNow = now;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d") ?? null;

      if (phaseRef.current === "drawing") {
        const t = Math.max(0, Math.min(1, (now - start) / durationMs));
        const eased = 1 - (1 - t) ** 2.2;
        setProgress(eased);

        const zoom = startZoom + (finalZoom - startZoom) * easeOutCubic(t);
        map.jumpTo({ zoom, center: finalCenter });

        const { path, tip: tipCoord } = slicePathByProgress(coordinates, eased);
        projectPath(path);
        if (tipCoord) {
          const p = map.project(tipCoord);
          const current = { x: p.x, y: p.y };
          setTip(current);

          if (lastTip && t < 0.985) {
            const dx = current.x - lastTip.x;
            const dy = current.y - lastTip.y;
            const speed = Math.hypot(dx, dy) / Math.max(dt, 1);
            const count = Math.min(6, 1 + Math.round(speed * 7));
            spawnSparks(current, dx, dy, count);
          }
          lastTip = current;
        }

        if (ctx) drawSparks(ctx, dt);

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

        if (ctx) drawSparks(ctx, dt);

        if (t >= 1) {
          if (ctx) {
            const { width, height } = canvasSizeRef.current;
            ctx.clearRect(0, 0, width, height);
          }
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
          <g
            transform={`translate(${tip.x} ${tip.y})`}
            className="route-draw-tip-flicker"
          >
            <circle r={16} fill="#f97316" opacity={0.28} filter="url(#route-draw-glow)" />
            <circle r={6.5} fill="#fbbf24" />
            <circle r={2.6} fill="#fffbeb" />
          </g>
        ) : null}
      </svg>

      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

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
