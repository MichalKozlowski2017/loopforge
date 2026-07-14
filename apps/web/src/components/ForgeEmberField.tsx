"use client";

import { useMemo, type CSSProperties } from "react";

type SparkVarStyle = CSSProperties & {
  "--spark-dx"?: string;
  "--spark-dy"?: string;
};

type GlowVarStyle = CSSProperties & {
  "--glow-scale-from"?: string;
  "--glow-scale-to"?: string;
  "--glow-shift-x"?: string;
  "--glow-shift-y"?: string;
  "--glow-opacity-from"?: string;
  "--glow-opacity-to"?: string;
};

interface Glow {
  left: number;
  top: number;
  size: number;
  blur: number;
  duration: number;
  delay: number;
  hue: number;
  scaleFrom: number;
  scaleTo: number;
  shiftX: number;
  shiftY: number;
  opacityFrom: number;
  opacityTo: number;
}

interface WeldSpark {
  left: number;
  top: number;
  size: number;
  dx: number;
  dy: number;
  duration: number;
  delay: number;
  hue: number;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Soft ambient glow blobs scattered around a random angle/radius from
 * center (not a repeating quadrant grid) so placement never looks patterned,
 * each with its own pulse amplitude/drift/blur so the whole field breathes
 * unevenly instead of in lockstep.
 */
function buildGlows(count: number): Glow[] {
  return Array.from({ length: count }, () => {
    const angle = randomBetween(0, Math.PI * 2);
    const radius = randomBetween(38, 78);
    const left = 50 + Math.cos(angle) * radius;
    const top = 50 + Math.sin(angle) * radius * 0.85;
    return {
      left,
      top,
      size: randomBetween(150, 420),
      blur: randomBetween(36, 100),
      duration: randomBetween(3.2, 8),
      delay: randomBetween(-8, 0),
      hue: Math.floor(randomBetween(0, 3)),
      scaleFrom: randomBetween(0.7, 0.95),
      scaleTo: randomBetween(1.25, 1.75),
      shiftX: randomBetween(-10, 10),
      shiftY: randomBetween(-10, 10),
      opacityFrom: randomBetween(0.3, 0.55),
      opacityTo: randomBetween(0.75, 1),
    };
  });
}

/** Welding-style sparks: a quick bright pop that flies sideways and falls, at random spots and moments. */
function buildWeldSparks(count: number): WeldSpark[] {
  return Array.from({ length: count }, () => ({
    left: randomBetween(2, 98),
    top: randomBetween(4, 82),
    size: randomBetween(1.6, 3.4),
    dx: randomBetween(-90, 90),
    dy: randomBetween(40, 130),
    duration: randomBetween(2.2, 5.2),
    delay: randomBetween(0, 5),
    hue: Math.floor(randomBetween(0, 3)),
  }));
}

const GLOW_COLORS = [
  "rgba(249,115,22,0.42)",
  "rgba(217,119,6,0.4)",
  "rgba(251,191,36,0.36)",
];

const SPARK_COLORS = ["#fde68a", "#fdba74", "#fb923c"];

/**
 * Ambient atmosphere for the generation overlay: bold, irregularly pulsing
 * blur blobs scattered at random angles/radii for a bit of dynamism (no
 * literal flame shapes), plus tiny welding-style sparks popping and
 * darting sideways as they fall at random spots and moments. Purely
 * decorative (aria-hidden); values are randomized once per mount so it
 * never looks mechanical or repeating.
 */
export function ForgeEmberField() {
  const glows = useMemo(() => buildGlows(10), []);
  const sparks = useMemo(() => buildWeldSparks(28), []);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {glows.map((glow, index) => (
        <div
          key={index}
          className="loopforge-ambient-glow absolute rounded-full"
          style={
            {
              left: `${glow.left}%`,
              top: `${glow.top}%`,
              width: `${glow.size}px`,
              height: `${glow.size}px`,
              filter: `blur(${glow.blur}px)`,
              background: `radial-gradient(circle, ${GLOW_COLORS[glow.hue % GLOW_COLORS.length]} 0%, transparent 72%)`,
              animationDuration: `${glow.duration}s`,
              animationDelay: `${glow.delay}s`,
              "--glow-scale-from": glow.scaleFrom.toFixed(2),
              "--glow-scale-to": glow.scaleTo.toFixed(2),
              "--glow-shift-x": `${glow.shiftX}%`,
              "--glow-shift-y": `${glow.shiftY}%`,
              "--glow-opacity-from": glow.opacityFrom.toFixed(2),
              "--glow-opacity-to": glow.opacityTo.toFixed(2),
            } as GlowVarStyle
          }
        />
      ))}

      {sparks.map((spark, index) => (
        <span
          key={index}
          className="loopforge-weld-spark absolute rounded-full"
          style={
            {
              left: `${spark.left}%`,
              top: `${spark.top}%`,
              width: `${spark.size}px`,
              height: `${spark.size}px`,
              backgroundColor: SPARK_COLORS[spark.hue % SPARK_COLORS.length],
              boxShadow: `0 0 ${spark.size * 2.2}px ${SPARK_COLORS[spark.hue % SPARK_COLORS.length]}`,
              animationDuration: `${spark.duration}s`,
              animationDelay: `${spark.delay}s`,
              "--spark-dx": `${spark.dx}px`,
              "--spark-dy": `${spark.dy}px`,
            } as SparkVarStyle
          }
        />
      ))}
    </div>
  );
}
