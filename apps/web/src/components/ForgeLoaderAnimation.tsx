"use client";

import { useEffect, useRef, useState } from "react";

interface ForgeLoaderAnimationProps {
  seconds: number;
  /**
   * Real generation progress, 0–100. Drives what's forming on the anvil —
   * the metal visibly becomes the route as the backend actually works,
   * instead of looping through a fixed-time animation. Generation can take
   * anywhere from ~20s to ~70s, so the shape crawls slowly and only ever
   * advances as far as real progress allows.
   */
  progressPercent?: number;
}

type Point = readonly [number, number];

/**
 * Four loop outlines sharing the same 20-point layout, so any pair can be
 * linearly interpolated point-by-point and still resolve into a clean
 * closed spline. The metal starts as an undecided flat ingot, rounds into
 * a draft loop once a shape is chosen, settles into a simple route once
 * BRouter has something, then visibly gains extra bends and kinks as the
 * route is scored and refined into its final, more detailed shape.
 */
const INGOT_POINTS: Point[] = [
  [135, 123],
  [133.29, 123.49],
  [128.32, 123.94],
  [120.57, 124.29],
  [110.82, 124.52],
  [100, 124.6],
  [89.18, 124.52],
  [79.43, 124.29],
  [71.68, 123.94],
  [66.71, 123.49],
  [65, 123],
  [66.71, 122.51],
  [71.68, 122.06],
  [79.43, 121.71],
  [89.18, 121.48],
  [100, 121.4],
  [110.82, 121.48],
  [120.57, 121.71],
  [128.32, 122.06],
  [133.29, 122.51],
];

const DRAFT_POINTS: Point[] = [
  [135, 123],
  [133.29, 126.09],
  [128.32, 128.88],
  [120.57, 131.09],
  [110.82, 132.51],
  [100, 133],
  [89.18, 132.51],
  [79.43, 131.09],
  [71.68, 128.88],
  [66.71, 126.09],
  [65, 123],
  [66.71, 119.91],
  [71.68, 117.12],
  [79.43, 114.91],
  [89.18, 113.49],
  [100, 113],
  [110.82, 113.49],
  [120.57, 114.91],
  [128.32, 117.12],
  [133.29, 119.91],
];

const ROUTE_POINTS: Point[] = [
  [136.12, 123],
  [136.77, 126.69],
  [131.88, 130.14],
  [122.24, 132.15],
  [110.44, 131.04],
  [100, 128.6],
  [91.38, 129.31],
  [83.36, 129.77],
  [75.83, 128.41],
  [68.84, 126.13],
  [63.88, 123],
  [63.23, 119.31],
  [68.11, 115.84],
  [77.6, 113.48],
  [89.11, 112.65],
  [100, 113.15],
  [109.07, 114.38],
  [116.8, 115.86],
  [124.18, 117.57],
  [131.16, 119.87],
];

const DETAILED_ROUTE_POINTS: Point[] = [
  [137.28, 123],
  [139.12, 129],
  [132.97, 137.32],
  [121.72, 143.69],
  [107.41, 138.66],
  [100, 136.07],
  [89.72, 145.38],
  [81.82, 140.29],
  [71.3, 135.46],
  [72.91, 127.16],
  [72.59, 123],
  [66.1, 119.33],
  [66.26, 114.83],
  [77.6, 112.72],
  [88.63, 111.33],
  [100, 112.56],
  [107.6, 115.2],
  [118.57, 114.48],
  [120.08, 118.14],
  [128.32, 119.93],
];

/** Progress percentages at which the metal fully reaches each shape. */
const SHAPE_KEYFRAMES: { at: number; points: Point[] }[] = [
  { at: 0, points: INGOT_POINTS },
  { at: 22, points: DRAFT_POINTS },
  { at: 55, points: ROUTE_POINTS },
  { at: 92, points: DETAILED_ROUTE_POINTS },
];

function lerpPoints(a: Point[], b: Point[], t: number): Point[] {
  return a.map(([ax, ay], i) => {
    const [bx, by] = b[i];
    return [ax + (bx - ax) * t, ay + (by - ay) * t] as Point;
  });
}

/** Points forged so far at a given progress percentage (0–100). */
function pointsAtProgress(progress: number): Point[] {
  const p = Math.max(0, Math.min(100, progress));
  if (p <= SHAPE_KEYFRAMES[0].at) return SHAPE_KEYFRAMES[0].points;
  for (let i = 0; i < SHAPE_KEYFRAMES.length - 1; i++) {
    const a = SHAPE_KEYFRAMES[i];
    const b = SHAPE_KEYFRAMES[i + 1];
    if (p <= b.at) {
      const t = (p - a.at) / (b.at - a.at);
      return lerpPoints(a.points, b.points, t);
    }
  }
  return SHAPE_KEYFRAMES[SHAPE_KEYFRAMES.length - 1].points;
}

/** Closed Catmull-Rom spline through the points, as an SVG path `d` string. */
function buildLoopPath(points: Point[]): string {
  const n = points.length;
  const fmt = (v: number) => v.toFixed(2);
  let d = `M ${fmt(points[0][0])} ${fmt(points[0][1])} `;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[(i - 1 + n) % n];
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    const [x3, y3] = points[(i + 2) % n];
    const cp1x = x1 + (x2 - x0) / 6;
    const cp1y = y1 + (y2 - y0) / 6;
    const cp2x = x2 - (x3 - x1) / 6;
    const cp2y = y2 - (y3 - y1) / 6;
    d += `C ${fmt(cp1x)} ${fmt(cp1y)} ${fmt(cp2x)} ${fmt(cp2y)} ${fmt(x2)} ${fmt(y2)} `;
  }
  return d + "Z";
}

/**
 * Smoothly chases a target percentage instead of jumping straight to it, so
 * the anvil shape crawls forward continuously even between sparse progress
 * updates from the server — but never advances past what's actually done.
 */
function useSmoothedProgress(target: number): number {
  const [displayed, setDisplayed] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    const id = setInterval(() => {
      setDisplayed((prev) => {
        const diff = targetRef.current - prev;
        if (Math.abs(diff) < 0.05) return targetRef.current;
        const step = Math.sign(diff) * Math.min(Math.abs(diff), Math.abs(diff) * 0.1 + 0.12);
        return prev + step;
      });
    }, 150);
    return () => clearInterval(id);
  }, []);

  return displayed;
}

/**
 * Hammer drawn in its impact pose: handle horizontal, head face flat on the
 * hot metal (bottom of head at y=118, centered on x=89). The strike animation
 * only rotates around the grip pivot (24, 98) — 0deg is the exact moment of
 * impact, negative angles raise the hammer.
 */
function HammerShape() {
  return (
    <g>
      {/* Handle */}
      <rect x="20" y="94.8" width="64" height="6.4" rx="3.2" fill="#a16207" />
      <rect x="20" y="94" width="14" height="8" rx="4" fill="#854d0e" />
      {/* Head — face down, resting on the metal */}
      <rect
        x="80"
        y="92"
        width="18"
        height="26"
        rx="2.5"
        fill="url(#forgeHammerHead)"
      />
      {/* Cross-peen on top */}
      <path d="M 84 92 L 94 92 L 91 84 L 87 84 Z" fill="#52525b" />
      {/* Highlight */}
      <rect x="82" y="94.5" width="3" height="21" rx="1.5" fill="#d4d4d8" opacity="0.7" />
    </g>
  );
}

interface SparkBurstProps {
  delaySeconds?: number;
}

/** Four sparks flying out of one impact point in different arcs. */
function SparkBurst({ delaySeconds = 0 }: SparkBurstProps) {
  const delay = (offset: number) => ({
    animationDelay: `${delaySeconds + offset}s`,
  });
  return (
    <g>
      <circle r="2.6" className="fill-amber-300 loopforge-spark loopforge-spark-a" style={delay(0)} />
      <circle r="2" className="fill-yellow-200 loopforge-spark loopforge-spark-b" style={delay(0.02)} />
      <circle r="2.4" className="fill-orange-400 loopforge-spark loopforge-spark-c" style={delay(0.01)} />
      <circle r="1.8" className="fill-amber-400 loopforge-spark loopforge-spark-d" style={delay(0.03)} />
    </g>
  );
}

/** Animated anvil + twin alternating hammers for the generation overlay. */
export function ForgeLoaderAnimation({
  seconds,
  progressPercent = 0,
}: ForgeLoaderAnimationProps) {
  const smoothed = useSmoothedProgress(progressPercent);
  const shapeD = `path("${buildLoopPath(pointsAtProgress(smoothed))}")`;

  return (
    <div className="relative h-36 w-36 sm:h-44 sm:w-44">
      <div className="absolute inset-0 rounded-full bg-amber-500/15 blur-2xl loopforge-forge-glow" />
      <div className="absolute bottom-6 left-1/2 h-8 w-24 -translate-x-1/2 rounded-full bg-orange-500/25 blur-xl loopforge-ember-pulse" />

      <svg viewBox="0 0 200 200" className="relative h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="forgeAnvil" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#71717a" />
            <stop offset="100%" stopColor="#3f3f46" />
          </linearGradient>
          <linearGradient id="forgeMetal" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="50%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
          <linearGradient id="forgeHammerHead" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#a1a1aa" />
            <stop offset="55%" stopColor="#71717a" />
            <stop offset="100%" stopColor="#3f3f46" />
          </linearGradient>
          <radialGradient id="forgeFlash">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="55%" stopColor="#fbbf24" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Anvil + hot metal loop — a glowing shape being hammered from a
            raw ingot into the actual route, echoing real generation
            progress instead of a fixed-time animation. */}
        <g className="loopforge-anvil">
          <path
            d="M 52 138 L 148 138 L 132 158 L 68 158 Z"
            fill="url(#forgeAnvil)"
          />
          <path d="M 68 138 L 132 138 L 124 128 L 76 128 Z" fill="#52525b" />
          <rect x="76" y="127.4" width="48" height="1.6" fill="#71717a" />
          <path
            fill="none"
            stroke="url(#forgeMetal)"
            strokeWidth="9"
            className="loopforge-hot-metal loopforge-metal-shape"
            style={{ d: shapeD }}
          />
          <path
            fill="none"
            stroke="#fef3c7"
            strokeWidth="1.4"
            opacity="0.35"
            className="loopforge-hot-metal loopforge-metal-shape"
            style={{ d: shapeD }}
          />
        </g>

        {/* Left hammer — strikes the ring's near-left arc */}
        <g className="loopforge-hammer">
          <HammerShape />
        </g>
        {/* Right hammer — mirrored, strikes the ring's near-right arc half a cycle later */}
        <g transform="translate(200 0) scale(-1 1)">
          <g className="loopforge-hammer" style={{ animationDelay: "-0.75s" }}>
            <HammerShape />
          </g>
        </g>

        {/* Impact flashes */}
        <g transform="translate(88 115)">
          <circle r="12" fill="url(#forgeFlash)" className="loopforge-impact-flash" />
        </g>
        <g transform="translate(112 115)">
          <circle
            r="12"
            fill="url(#forgeFlash)"
            className="loopforge-impact-flash"
            style={{ animationDelay: "-0.75s" }}
          />
        </g>

        {/* Spark bursts synced to each hit */}
        <g transform="translate(88 115)">
          <SparkBurst />
        </g>
        <g transform="translate(112 115) scale(-1 1)">
          <SparkBurst delaySeconds={-0.75} />
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center">
        <span className="rounded-full border border-amber-500/30 bg-zinc-950/80 px-3 py-1 font-mono text-sm font-semibold tabular-nums text-amber-200">
          {seconds}s
        </span>
      </div>
    </div>
  );
}
