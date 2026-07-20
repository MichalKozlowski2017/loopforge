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
    /** Meters of sampled path farther than maxPointDistanceM from the network. */
    offPathM: number;
    offPathShare: number;
    /** Worst sample distance from the on-network reference polyline. */
    maxOffPathDistanceM: number;
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
  /**
   * Pre-prune BRouter polyline — samples of `coordinates` must stay near it.
   * When omitted, on-path share checks are skipped (teleports still apply).
   */
  networkCoordinates?: [number, number][];
  /** Max distance from network to count as on-road (default 35 m). */
  maxPointDistanceM?: number;
  /** Sample spacing along the route for on-path checks (default 20 m). */
  onPathSampleSpacingM?: number;
  /** Max off-network share of length (default 0.02 = 2%). */
  maxOffPathShare?: number;
  /** Absolute off-network budget (default 80 m). */
  maxOffPathM?: number;
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

function pointToSegmentDistanceM(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const latRad = ((p[1] + a[1] + b[1]) / 3) * (Math.PI / 180);
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(latRad);
  const ax = a[0] * metersPerDegLng;
  const ay = a[1] * metersPerDegLat;
  const bx = b[0] * metersPerDegLng;
  const by = b[1] * metersPerDegLat;
  const px = p[0] * metersPerDegLng;
  const py = p[1] * metersPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Minimum distance from a point to any edge of a polyline. */
export function distanceToPolylineM(
  point: [number, number],
  line: [number, number][],
): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversineM(point, line[0]!);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    best = Math.min(
      best,
      pointToSegmentDistanceM(point, line[i - 1]!, line[i]!),
    );
  }
  return best;
}

function interpolateAlong(
  coordinates: [number, number][],
  distanceM: number,
): [number, number] | null {
  if (coordinates.length < 2 || distanceM < 0) return null;
  let remaining = distanceM;
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1]!;
    const b = coordinates[i]!;
    const edge = haversineM(a, b);
    if (edge <= 0) continue;
    if (remaining <= edge) {
      const t = remaining / edge;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= edge;
  }
  return coordinates[coordinates.length - 1] ?? null;
}

/**
 * Sample the display polyline and measure how much of it leaves the BRouter
 * on-network reference (pre-prune path). Air-chords / map shortcuts show up as
 * mid-edge points far from the network.
 */
export function measureOffPath(
  coordinates: [number, number][],
  network: [number, number][],
  options: {
    maxPointDistanceM?: number;
    sampleSpacingM?: number;
  } = {},
): { offPathM: number; offPathShare: number; maxDistanceM: number; lengthM: number } {
  const lengthM = coordinates.length >= 2 ? routeLengthM(coordinates) : 0;
  if (lengthM <= 0 || network.length < 2) {
    return { offPathM: 0, offPathShare: 0, maxDistanceM: 0, lengthM };
  }

  const maxPointDistanceM = options.maxPointDistanceM ?? 35;
  const sampleSpacingM = options.sampleSpacingM ?? 20;
  let offPathM = 0;
  let maxDistanceM = 0;

  for (let d = 0; d <= lengthM; d += sampleSpacingM) {
    const point = interpolateAlong(coordinates, Math.min(d, lengthM));
    if (!point) continue;
    const dist = distanceToPolylineM(point, network);
    maxDistanceM = Math.max(maxDistanceM, dist);
    if (dist > maxPointDistanceM) {
      offPathM += sampleSpacingM;
    }
  }

  // Don't over-count past route length from the last partial step.
  offPathM = Math.min(offPathM, lengthM);
  return {
    offPathM,
    offPathShare: lengthM > 0 ? offPathM / lengthM : 0,
    maxDistanceM,
    lengthM,
  };
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

  let offPathM = 0;
  let offPathShare = 0;
  let maxOffPathDistanceM = 0;
  const network = options.networkCoordinates;
  if (network && network.length >= 2 && coordinates.length >= 2) {
    const onPath = measureOffPath(coordinates, network, {
      maxPointDistanceM: options.maxPointDistanceM ?? 35,
      sampleSpacingM: options.onPathSampleSpacingM ?? 20,
    });
    offPathM = onPath.offPathM;
    offPathShare = onPath.offPathShare;
    maxOffPathDistanceM = onPath.maxDistanceM;
    const maxOffPathShare = options.maxOffPathShare ?? 0.02;
    const maxOffPathTotalM = options.maxOffPathM ?? 80;
    if (offPathShare > maxOffPathShare || offPathM > maxOffPathTotalM) {
      findings.push({
        code: "OFF_NETWORK",
        severity: "error",
        message: `Trasa schodzi z dróg/ścieżek na ~${Math.round(offPathM)} m (${(offPathShare * 100).toFixed(1)}%, max ${Math.round(maxOffPathDistanceM)} m od sieci BRouter).`,
        value: offPathM,
        limit: maxOffPathTotalM,
      });
    }
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
      offPathM,
      offPathShare,
      maxOffPathDistanceM,
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
    `  offPath=${(audit.metrics.offPathShare * 100).toFixed(1)}% (${Math.round(audit.metrics.offPathM)} m, max ${Math.round(audit.metrics.maxOffPathDistanceM)} m)`,
    `  wrongWay=${Math.round(audit.metrics.wrongWaySegmentM)} m use_sidepath=${Math.round(audit.metrics.useSidepathSegmentM)} m`,
  ];
  for (const finding of audit.findings) {
    lines.push(`  [${finding.severity}] ${finding.code}: ${finding.message}`);
  }
  return lines.join("\n");
}

export type RouteBetweenPoints = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) => Promise<[number, number][]>;

/**
 * Re-route suspiciously long display edges with BRouter. An air-chord across a
 * field is much shorter than the on-road path BRouter returns for the same
 * endpoints — fail when that happens.
 */
export async function auditLongEdgesWithRouter(
  coordinates: [number, number][],
  routeBetween: RouteBetweenPoints,
  options: {
    minEdgeM?: number;
    maxEdges?: number;
    /** Fail when routed length exceeds display edge × this (default 1.55). */
    maxLengthRatio?: number;
    /** Extra absolute slack on top of ratio (default 120 m). */
    lengthSlackM?: number;
  } = {},
): Promise<RouteQualityFinding[]> {
  const minEdgeM = options.minEdgeM ?? 70;
  const maxEdges = options.maxEdges ?? 8;
  const maxLengthRatio = options.maxLengthRatio ?? 1.55;
  const lengthSlackM = options.lengthSlackM ?? 120;
  const findings: RouteQualityFinding[] = [];

  const candidates: Array<{
    from: [number, number];
    to: [number, number];
    edgeM: number;
  }> = [];
  for (let i = 1; i < coordinates.length; i++) {
    const from = coordinates[i - 1]!;
    const to = coordinates[i]!;
    const edgeM = haversineM(from, to);
    if (edgeM >= minEdgeM) {
      candidates.push({ from, to, edgeM });
    }
  }
  candidates.sort((a, b) => b.edgeM - a.edgeM);
  const check = candidates.slice(0, maxEdges);

  let badM = 0;
  for (const edge of check) {
    try {
      const routed = await routeBetween(
        { lng: edge.from[0], lat: edge.from[1] },
        { lng: edge.to[0], lat: edge.to[1] },
      );
      if (routed.length < 2) continue;
      const routedM = routeLengthM(routed);
      const limit = edge.edgeM * maxLengthRatio + lengthSlackM;
      if (routedM > limit) {
        badM += edge.edgeM;
        // Midpoint of the display edge should also sit near the routed path.
        const mid: [number, number] = [
          (edge.from[0] + edge.to[0]) / 2,
          (edge.from[1] + edge.to[1]) / 2,
        ];
        const midDist = distanceToPolylineM(mid, routed);
        if (midDist > 45) {
          findings.push({
            code: "EDGE_OFF_ROAD",
            severity: "error",
            message: `Krawędź ${Math.round(edge.edgeM)} m to skrót poza drogą (BRouter: ${Math.round(routedM)} m, środek ${Math.round(midDist)} m od sieci).`,
            value: edge.edgeM,
            limit: minEdgeM,
          });
        }
      }
    } catch {
      // Transient routing miss — skip; geometry/teleport audits still apply.
    }
  }

  if (badM > 150 && !findings.some((f) => f.code === "EDGE_OFF_ROAD")) {
    findings.push({
      code: "EDGE_OFF_ROAD",
      severity: "error",
      message: `Suma podejrzanych skrótów poza drogą: ~${Math.round(badM)} m (BRouter idzie wyraźnie dłuższą trasą).`,
      value: badM,
      limit: 150,
    });
  }

  return findings;
}
