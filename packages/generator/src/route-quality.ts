import type { OsmTags } from "@loopforge/osm-types";
import { downsampleCoordinates, loopQualityMetrics } from "./loop-waypoints";
import {
  findDeadEndSpurRanges,
  findHairpinSpurRanges,
  findMicroSpurRanges,
  findOpenPathBranchStubRanges,
  findReverseSegmentSpurRanges,
  findStubSpurRanges,
  hasHardTeleportEdge,
  hasSuspiciousTeleportEdge,
  maxConsecutiveEdgeM,
  routeLengthM,
  type GeometryContext,
} from "./prune-spurs";

const SPUR_DETECT_MAX_POINTS = 600;
export type RouteQualitySeverity = "error" | "warn";

export type RouteQualityFinding = {
  code: string;
  severity: RouteQualitySeverity;
  message: string;
  value?: number;
  limit?: number;
};

export type RouteQualityAudit = {
  ok: boolean;
  findings: RouteQualityFinding[];
  metrics: {
    lengthM: number;
    maxEdgeM: number;
    spurShare: number;
    backtrack: number;
    remainingSpurRanges: number;
    mirroredPrefixM: number;
    wrongWaySegmentM: number;
    useSidepathSegmentM: number;
  };
};

export type RouteQualityOptions = {
  /** Expected loop length for distance-error context (optional). */
  targetDistanceKm?: number;
  /** Actual length override; defaults to polyline length. */
  actualDistanceKm?: number;
  /** Geometry safety context (start pin / urban override). */
  geometryContext?: GeometryContext;
  /**
   * When true, start≈end and a short mirrored prefix are expected (dojazd).
   * When false, long mirrored out-and-back at the ends fails the audit.
   */
  allowApproachMirror?: boolean;
  /** Max allowed spur share of total length (default 0.05). */
  maxSpurShare?: number;
  /** Max allowed backtrack ratio (default 0.05). */
  maxBacktrack?: number;
  /** Fail when detector spur ranges remain (default false — corner false-positives). */
  failOnRemainingSpurs?: boolean;
  /** Max mirrored start/end overlap for loop-only tracks (default 400 m). */
  maxMirroredPrefixM?: number;
};

function haversineM(
  a: [number, number],
  b: [number, number],
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * Length of the prefix that mirrors the suffix in reverse (out-and-back /
 * dojazd+powrót). Matches exact coordinates after typical GPX rounding.
 */
export function mirroredPrefixLengthM(
  coordinates: [number, number][],
  matchM = 8,
): number {
  if (coordinates.length < 4) return 0;

  let k = 0;
  const n = coordinates.length;
  while (k < Math.floor(n / 2)) {
    if (haversineM(coordinates[k]!, coordinates[n - 1 - k]!) > matchM) break;
    k++;
  }
  if (k < 2) return 0;

  let lengthM = 0;
  for (let i = 0; i < k - 1; i++) {
    lengthM += haversineM(coordinates[i]!, coordinates[i + 1]!);
  }
  return lengthM;
}

function countRemainingSpurRanges(coordinates: [number, number][]): number {
  const sampled = downsampleCoordinates(coordinates, SPUR_DETECT_MAX_POINTS);
  return (
    findDeadEndSpurRanges(sampled).length +
    findMicroSpurRanges(sampled).length +
    findStubSpurRanges(sampled).length +
    findHairpinSpurRanges(sampled).length +
    findReverseSegmentSpurRanges(sampled).length +
    findOpenPathBranchStubRanges(sampled).length
  );
}

/**
 * Heuristic wrong-way / sidepath flags from BRouter OSM tags.
 * Full legal oneway direction needs BRouter's reversedirection bit; tags alone
 * catch hard bans we encode in profiles (use_sidepath, bicycle=no).
 */
export function segmentAccessIssues(
  segments: { tags: OsmTags; distanceM: number }[],
): { wrongWayM: number; useSidepathM: number; findings: RouteQualityFinding[] } {
  let wrongWayM = 0;
  let useSidepathM = 0;
  const findings: RouteQualityFinding[] = [];

  for (const segment of segments) {
    const tags = segment.tags;
    const bicycle = tags.bicycle?.toLowerCase();
    if (bicycle === "use_sidepath") {
      useSidepathM += segment.distanceM;
    }
    if (bicycle === "no" || bicycle === "dismount") {
      wrongWayM += segment.distanceM;
    }
    // Explicit opposite-direction cycling is fine; plain oneway without
    // bicycle exemption is only a soft signal (BRouter should avoid it).
    const oneway = tags.oneway?.toLowerCase();
    const onewayBike = tags["oneway:bicycle"]?.toLowerCase();
    if (
      (oneway === "yes" || oneway === "true" || oneway === "1") &&
      onewayBike !== "no" &&
      tags.cycleway !== "opposite" &&
      tags.cycleway !== "opposite_lane" &&
      tags.cycleway !== "opposite_track" &&
      tags["cycleway:left"] !== "opposite" &&
      tags["cycleway:right"] !== "opposite"
    ) {
      // Not counted as hard wrong-way without reverse flag — informational only.
    }
  }

  if (useSidepathM > 25) {
    findings.push({
      code: "USE_SIDEPATH",
      severity: "error",
      message: `Trasa używa dróg z bicycle=use_sidepath (~${Math.round(useSidepathM)} m) — powinno iść ścieżką.`,
      value: useSidepathM,
      limit: 25,
    });
  }

  if (wrongWayM > 25) {
    findings.push({
      code: "BICYCLE_FORBIDDEN",
      severity: "error",
      message: `Odcinki z zakazem roweru (~${Math.round(wrongWayM)} m).`,
      value: wrongWayM,
      limit: 25,
    });
  }

  return { wrongWayM, useSidepathM, findings };
}

/**
 * Offline geometry / quality audit for a generated (or GPX) loop polyline.
 * Proxies “stays on paths” via teleport / air-chord checks; full OSM snap
 * needs a live routing backend.
 */
export function auditRouteGeometry(
  coordinates: [number, number][],
  options: RouteQualityOptions = {},
): RouteQualityAudit {
  const findings: RouteQualityFinding[] = [];
  const lengthM = coordinates.length >= 2 ? routeLengthM(coordinates) : 0;
  const actualDistanceKm = options.actualDistanceKm ?? lengthM / 1000;
  const targetDistanceKm = options.targetDistanceKm ?? actualDistanceKm;
  const maxSpurShare = options.maxSpurShare ?? 0.05;
  const maxBacktrack = options.maxBacktrack ?? 0.05;
  const maxMirroredPrefixM = options.maxMirroredPrefixM ?? 400;
  const failOnRemainingSpurs = options.failOnRemainingSpurs === true;
  const ctx = options.geometryContext ?? {};

  const maxEdgeM = coordinates.length >= 2 ? maxConsecutiveEdgeM(coordinates) : 0;
  const metrics = loopQualityMetrics(
    coordinates,
    targetDistanceKm,
    actualDistanceKm,
  );
  const remainingSpurRanges = countRemainingSpurRanges(coordinates);
  const mirroredPrefixM = mirroredPrefixLengthM(coordinates);

  if (coordinates.length < 4) {
    findings.push({
      code: "TOO_FEW_POINTS",
      severity: "error",
      message: "Za mało punktów trasy do sensownej walidacji.",
      value: coordinates.length,
      limit: 4,
    });
  }

  if (hasHardTeleportEdge(coordinates)) {
    findings.push({
      code: "HARD_TELEPORT",
      severity: "error",
      message: `Skok >1,2 km między punktami (max krawędź ${Math.round(maxEdgeM)} m) — poza ścieżką / air-chord.`,
      value: maxEdgeM,
      limit: 1200,
    });
  } else if (hasSuspiciousTeleportEdge(coordinates, ctx)) {
    findings.push({
      code: "SUSPICIOUS_TELEPORT",
      severity: "warn",
      message: `Podejrzany lokalny air-chord (max krawędź ${Math.round(maxEdgeM)} m).`,
      value: maxEdgeM,
    });
  }

  if (metrics.spurShare > maxSpurShare) {
    findings.push({
      code: "SPUR_SHARE",
      severity: "error",
      message: `Ślepe zaułki / out-and-back: ${(metrics.spurShare * 100).toFixed(1)}% trasy.`,
      value: metrics.spurShare,
      limit: maxSpurShare,
    });
  }

  if (metrics.backtrack > maxBacktrack) {
    findings.push({
      code: "BACKTRACK",
      severity: "error",
      message: `Jazda w przeciwnym kierunku po tym samym odcinku (backtrack ${(metrics.backtrack * 100).toFixed(1)}%).`,
      value: metrics.backtrack,
      limit: maxBacktrack,
    });
  }

  if (remainingSpurRanges > 0 && (failOnRemainingSpurs || metrics.spurShare > 0.01)) {
    findings.push({
      code: "REMAINING_SPURS",
      severity: failOnRemainingSpurs ? "error" : "warn",
      message: `Detektory nadal widzą ${remainingSpurRanges} ślepych zaułków do wycięcia.`,
      value: remainingSpurRanges,
      limit: 0,
    });
  } else if (remainingSpurRanges > 0) {
    // Corner / densify noise — keep metric, skip finding unless spurShare agrees.
  }

  if (!options.allowApproachMirror && mirroredPrefixM > maxMirroredPrefixM) {
    findings.push({
      code: "MIRRORED_OUT_AND_BACK",
      severity: "error",
      message: `Początek i koniec pokrywają się na ~${Math.round(mirroredPrefixM)} m (out-and-back / niedocięty dojazd).`,
      value: mirroredPrefixM,
      limit: maxMirroredPrefixM,
    });
  }

  const ok = findings.every((f) => f.severity !== "error");

  return {
    ok,
    findings,
    metrics: {
      lengthM,
      maxEdgeM,
      spurShare: metrics.spurShare,
      backtrack: metrics.backtrack,
      remainingSpurRanges,
      mirroredPrefixM,
      wrongWaySegmentM: 0,
      useSidepathSegmentM: 0,
    },
  };
}

/** Geometry audit plus OSM tag access checks from BRouter segments. */
export function auditGeneratedRoute(
  coordinates: [number, number][],
  segments: { tags: OsmTags; distanceM: number }[] = [],
  options: RouteQualityOptions = {},
): RouteQualityAudit {
  const geometry = auditRouteGeometry(coordinates, options);
  const access = segmentAccessIssues(segments);
  const findings = [...geometry.findings, ...access.findings];
  return {
    ok: findings.every((f) => f.severity !== "error"),
    findings,
    metrics: {
      ...geometry.metrics,
      wrongWaySegmentM: access.wrongWayM,
      useSidepathSegmentM: access.useSidepathM,
    },
  };
}

export function formatRouteQualityReport(audit: RouteQualityAudit): string {
  const lines = [
    audit.ok ? "PASS route quality" : "FAIL route quality",
    `  length=${(audit.metrics.lengthM / 1000).toFixed(2)} km maxEdge=${Math.round(audit.metrics.maxEdgeM)} m`,
    `  spurShare=${(audit.metrics.spurShare * 100).toFixed(1)}% backtrack=${(audit.metrics.backtrack * 100).toFixed(1)}%`,
    `  remainingSpurs=${audit.metrics.remainingSpurRanges} mirroredPrefix=${Math.round(audit.metrics.mirroredPrefixM)} m`,
  ];
  for (const finding of audit.findings) {
    lines.push(`  [${finding.severity}] ${finding.code}: ${finding.message}`);
  }
  return lines.join("\n");
}
