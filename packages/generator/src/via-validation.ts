import type { Direction, LatLng, RouteViaPoint } from "@loopforge/osm-types";
import { computeLoopEntryTarget } from "./loop-anchor";

export const MAX_VIA_POINTS = 3;

export interface ViaPointRouteContext {
  start: LatLng;
  direction: Direction;
  distanceKm: number;
  approachEnabled?: boolean;
  approachDistanceKm?: number;
}

const DIRECTION_BEARING: Record<Direction, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

const EARTH_RADIUS_M = 6_371_000;

export type ViaPointStatus = "ok" | "warn" | "error";

export interface ViaPointValidation {
  status: ViaPointStatus;
  message: string;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLng = toRadians(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Loop anchor used for via-point zone checks (orange marker when approach is on). */
export function estimateLoopAnchor(context: ViaPointRouteContext): LatLng {
  if (context.approachEnabled) {
    return computeLoopEntryTarget(
      context.start,
      context.direction,
      context.distanceKm,
      context.approachDistanceKm,
    );
  }
  return context.start;
}

export function validateViaPointForRoute(
  context: ViaPointRouteContext,
  point: LatLng,
  label?: string,
): ViaPointValidation {
  const anchor = estimateLoopAnchor(context);
  const distM = haversineM(anchor, point);
  const distKm = distM / 1000;
  const maxRadiusKm = (context.distanceKm / 2) * 1.25;
  const bearing = bearingDeg(anchor, point);
  const dirDiff = angularDiffDeg(bearing, DIRECTION_BEARING[context.direction]);
  const name = label?.trim() || "Punkt";

  if (
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    (Math.abs(point.lat) < 0.0001 && Math.abs(point.lng) < 0.0001)
  ) {
    return {
      status: "error",
      message: `${name} — wybierz miejsce z wyszukiwarki.`,
    };
  }

  if (distKm < 0.35) {
    return {
      status: "error",
      message: `${name} jest zbyt blisko startu pętli (${distKm.toFixed(1)} km).`,
    };
  }

  if (dirDiff > 115) {
    return {
      status: "error",
      message: `${name} leży poza kierunkiem trasy (${dirDiff.toFixed(0)}° od wybranego kierunku). Zmień kierunek lub usuń punkt.`,
    };
  }

  if (distKm > maxRadiusKm) {
    return {
      status: "error",
      message: `${name} jest za daleko od pętli (${distKm.toFixed(1)} km, max ~${maxRadiusKm.toFixed(0)} km).`,
    };
  }

  if (dirDiff > 88 || distKm > maxRadiusKm * 0.88) {
    return {
      status: "warn",
      message: `${name} jest na skraju strefy trasy — pętla może wyjść dłuższa niż cel.`,
    };
  }

  return { status: "ok", message: `${name} mieści się w strefie pętli.` };
}

export function validateViaPointsForRoute(
  context: ViaPointRouteContext,
  points: RouteViaPoint[],
): { ok: boolean; results: ViaPointValidation[]; message?: string } {
  if (points.length > MAX_VIA_POINTS) {
    return {
      ok: false,
      results: [],
      message: `Maksymalnie ${MAX_VIA_POINTS} punkty przejazdu.`,
    };
  }

  const results = points.map((p) =>
    validateViaPointForRoute(context, p, p.label),
  );
  const firstError = results.find((r) => r.status === "error");
  if (firstError) {
    return { ok: false, results, message: firstError.message };
  }

  return { ok: true, results };
}
