import { describe, expect, it } from "vitest";
import {
  auditGeneratedRoute,
  auditRouteGeometry,
  measureOffPath,
  mirroredPrefixLengthM,
  maxMirroredPrefixBudgetM,
} from "./route-quality";
import {
  approachCorridor,
  rectLoop,
  withDeadEndSpur,
  withMirroredApproach,
  withTeleport,
} from "./fixtures/geo";
import { pruneDeadEndSpurs } from "./prune-spurs";
import {
  buildCoreRouteScenarios,
  buildLiveRouteScenarios,
  buildStressRouteScenarios,
  pickStressStarts,
  STRESS_DISTANCES_KM,
  STRESS_START_POOL,
  STRESS_START_POOL_EDGE,
} from "./route-quality.scenarios";

describe("auditRouteGeometry", () => {
  it("passes a clean closed rectangular loop", () => {
    const loop = rectLoop(0, 0, 3000, 2000);
    const audit = auditRouteGeometry(loop, {
      allowApproachMirror: false,
    });
    expect(audit.ok, format(audit)).toBe(true);
    expect(audit.metrics.lengthM).toBeGreaterThan(8000);
    expect(audit.metrics.maxEdgeM).toBeLessThan(1200);
    expect(audit.metrics.spurShare).toBeLessThan(0.05);
  });

  it("fails hard teleports (off-path air chords)", () => {
    const loop = withTeleport(rectLoop(0, 0, 2000, 1500), 20, 2500, 0);
    const audit = auditRouteGeometry(loop);
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "HARD_TELEPORT")).toBe(true);
  });

  it("detects dead-end spurs before prune", () => {
    const loop = withDeadEndSpur(rectLoop(0, 0, 2500, 1800), 15, 450);
    const audit = auditRouteGeometry(loop, { failOnRemainingSpurs: true });
    expect(audit.ok).toBe(false);
    expect(
      audit.findings.some(
        (f) =>
          f.code === "REMAINING_SPURS" ||
          f.code === "SPUR_SHARE" ||
          f.code === "BACKTRACK",
      ),
      format(audit),
    ).toBe(true);
  });

  it("reduces spur length after prune", () => {
    const dirty = withDeadEndSpur(rectLoop(0, 0, 2500, 1800), 15, 450);
    const before = auditRouteGeometry(dirty, { failOnRemainingSpurs: false });
    const pruned = pruneDeadEndSpurs(dirty, { urban: false });
    const after = auditRouteGeometry(pruned.coordinates, {
      allowApproachMirror: false,
      failOnRemainingSpurs: false,
    });
    expect(pruned.removedM).toBeGreaterThan(100);
    expect(after.metrics.spurShare).toBeLessThanOrEqual(before.metrics.spurShare);
    expect(after.ok, format(after)).toBe(true);
  });

  it("cuts short mid-loop fingers even when that shortens the route", () => {
    const clean = rectLoop(0, 0, 3000, 2000);
    const dirty = withDeadEndSpur(clean, Math.floor(clean.length / 2), 220);
    const pruned = pruneDeadEndSpurs(dirty, { urban: true });
    expect(pruned.removedM).toBeGreaterThan(150);
    expect(pruned.coordinates.length).toBeLessThan(dirty.length);
    const after = auditRouteGeometry(pruned.coordinates, {
      allowApproachMirror: false,
      failOnRemainingSpurs: false,
    });
    expect(after.metrics.spurShare).toBeLessThan(0.04);
  });

  it("fails severe distance undershoot against target", () => {
    const short = rectLoop(0, 0, 800, 600);
    const audit = auditRouteGeometry(short, {
      targetDistanceKm: 60,
      actualDistanceKm: 28,
      allowApproachMirror: false,
      failOnRemainingSpurs: false,
    });
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "DIST_UNDERSHOOT")).toBe(true);
  });

  it("flags long mirrored out-and-back on loop-only tracks", () => {
    const loop = rectLoop(0, 500, 2000, 1500);
    const approach = approachCorridor(1200);
    const withApproach = withMirroredApproach(loop, approach);
    expect(mirroredPrefixLengthM(withApproach)).toBeGreaterThan(800);

    const asLoopOnly = auditRouteGeometry(withApproach, {
      allowApproachMirror: false,
      maxMirroredPrefixM: 400,
      failOnRemainingSpurs: false,
    });
    expect(asLoopOnly.ok).toBe(false);
    expect(asLoopOnly.findings.some((f) => f.code === "MIRRORED_OUT_AND_BACK")).toBe(
      true,
    );

    const asWyjazd = auditRouteGeometry(withApproach, {
      allowApproachMirror: true,
      failOnRemainingSpurs: false,
    });
    expect(asWyjazd.findings.some((f) => f.code === "MIRRORED_OUT_AND_BACK")).toBe(
      false,
    );
  });

  it("allows mirrored prefix up to 5% of route length by default", () => {
    // ≤25 km: absolute floor for densified one-way egress (not mid-loop fingers).
    expect(maxMirroredPrefixBudgetM(20)).toBe(1400);
    expect(maxMirroredPrefixBudgetM(60)).toBe(3000);

    const loop = rectLoop(0, 500, 3000, 2000);
    const approach = approachCorridor(900);
    const withApproach = withMirroredApproach(loop, approach);
    const mirroredM = mirroredPrefixLengthM(withApproach);
    expect(mirroredM).toBeGreaterThan(800);

    // Budget from target 35 km = 1750 m → this ~1.3 km mirror passes.
    const ok = auditRouteGeometry(withApproach, {
      allowApproachMirror: false,
      targetDistanceKm: 35,
      failOnRemainingSpurs: false,
    });
    expect(
      ok.findings.some((f) => f.code === "MIRRORED_OUT_AND_BACK"),
      format(ok),
    ).toBe(false);

    // Budget from target 10 km = max(500, 1400) floor → need a longer corridor to fail.
    const longApproach = approachCorridor(1600);
    const withLongApproach = withMirroredApproach(loop, longApproach);
    expect(mirroredPrefixLengthM(withLongApproach)).toBeGreaterThan(1400);
    const tight = auditRouteGeometry(withLongApproach, {
      allowApproachMirror: false,
      targetDistanceKm: 10,
      failOnRemainingSpurs: false,
    });
    expect(
      tight.findings.some((f) => f.code === "MIRRORED_OUT_AND_BACK"),
    ).toBe(true);
  });

  it("counts mid-loop fingers as spur, not start/finish mirror", () => {
    const clean = rectLoop(0, 0, 3000, 2000);
    const midSpur = withDeadEndSpur(clean, Math.floor(clean.length / 2), 600);
    const midAudit = auditRouteGeometry(midSpur, {
      allowApproachMirror: false,
      failOnRemainingSpurs: false,
    });
    expect(midAudit.metrics.spurShare).toBeGreaterThan(0.04);

    const withMirror = withMirroredApproach(clean, approachCorridor(500));
    const mirrorOnly = auditRouteGeometry(withMirror, {
      allowApproachMirror: false,
      targetDistanceKm: 20,
      failOnRemainingSpurs: false,
    });
    // Start/finish out-and-back must not inflate mid-loop spurShare.
    expect(mirrorOnly.metrics.spurShare).toBeLessThan(0.04);
  });
});

describe("auditGeneratedRoute tags", () => {
  it("fails bicycle=use_sidepath segments", () => {
    const loop = rectLoop(0, 0, 1000, 800);
    const audit = auditGeneratedRoute(loop, [
      { tags: { highway: "residential", bicycle: "use_sidepath" }, distanceM: 120 },
      { tags: { highway: "cycleway", surface: "asphalt" }, distanceM: 800 },
    ]);
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "USE_SIDEPATH")).toBe(true);
  });

  it("fails bicycle=no segments", () => {
    const loop = rectLoop(0, 0, 1000, 800);
    const audit = auditGeneratedRoute(loop, [
      { tags: { highway: "primary", bicycle: "no" }, distanceM: 80 },
    ]);
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "BICYCLE_FORBIDDEN")).toBe(true);
  });
});

describe("on-path / network snap", () => {
  it("passes when display equals the BRouter network", () => {
    const loop = rectLoop(0, 0, 3000, 2000);
    const audit = auditRouteGeometry(loop, { networkCoordinates: loop });
    expect(audit.ok, format(audit)).toBe(true);
    expect(audit.metrics.offPathShare).toBeLessThan(0.01);
  });

  it("fails an air-chord that leaves the network", () => {
    const network = rectLoop(0, 0, 2000, 1500);
    // Chop a corner: connect opposite corners with a diagonal shortcut.
    const shortcut: [number, number][] = [
      network[0]!,
      network[Math.floor(network.length / 2)]!,
      network[network.length - 1]!,
    ];
    const off = measureOffPath(shortcut, network, {
      maxPointDistanceM: 35,
      sampleSpacingM: 20,
    });
    expect(off.offPathM).toBeGreaterThan(80);
    const audit = auditRouteGeometry(shortcut, {
      networkCoordinates: network,
      maxOffPathM: 80,
      maxOffPathShare: 0.02,
    });
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "OFF_NETWORK")).toBe(true);
  });
});

function format(audit: ReturnType<typeof auditRouteGeometry>): string {
  return audit.findings.map((f) => `${f.code}:${f.message}`).join(" | ") || "no findings";
}

describe("live route scenario matrix", () => {
  it("covers every bike × profile × UI toggle combo (72)", () => {
    const full = buildLiveRouteScenarios();
    expect(full).toHaveLength(72);
    expect(new Set(full.map((s) => s.id)).size).toBe(72);

    const gravel = full.filter((s) => s.request.bikeType === "gravel");
    expect(gravel).toHaveLength(24);
    expect(gravel.some((s) => s.request.avoidAsphalt === true)).toBe(true);
    expect(gravel.some((s) => s.request.avoidAsphalt === false)).toBe(true);
    expect(gravel.some((s) => s.request.preferQuietRoutes === true)).toBe(true);
    expect(gravel.some((s) => s.request.approachEnabled === true)).toBe(true);

    const road = full.filter((s) => s.request.bikeType === "road");
    expect(road).toHaveLength(12);
    expect(road.every((s) => s.request.avoidAsphalt == null)).toBe(true);
    expect(road.every((s) => s.urban === true)).toBe(true);

    const approach = full.filter((s) => s.request.approachEnabled);
    expect(approach.length).toBe(36);
    expect(
      approach.every((s) => s.request.approachDistanceKm === 8),
    ).toBe(true);
  });

  it("core smoke matrix is one row per bike × profile (12)", () => {
    const core = buildCoreRouteScenarios();
    expect(core).toHaveLength(12);
    expect(core.every((s) => !s.request.approachEnabled)).toBe(true);
  });

  it("stress matrix expands core × starts × distances (108)", () => {
    const stress = buildStressRouteScenarios({
      startCount: 3,
      distancesKm: [...STRESS_DISTANCES_KM],
      seed: 1,
    });
    expect(stress).toHaveLength(12 * 3 * 3);
    expect(new Set(stress.map((s) => s.id)).size).toBe(108);
    expect(stress.every((s) => s.placeId)).toBe(true);
    expect(
      new Set(stress.map((s) => s.request.distanceKm)),
    ).toEqual(new Set(STRESS_DISTANCES_KM));
  });

  it("stress-full expands all UI combos × starts × distances (648)", () => {
    const full = buildStressRouteScenarios({
      includeAllToggles: true,
      startCount: 3,
      distancesKm: [...STRESS_DISTANCES_KM],
      seed: 1,
    });
    expect(full).toHaveLength(72 * 3 * 3);
  });

  it("pickStressStarts is deterministic for a seed", () => {
    const a = pickStressStarts(3, 7).map((s) => s.id);
    const b = pickStressStarts(3, 7).map((s) => s.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(STRESS_START_POOL.length).toBeGreaterThanOrEqual(3);
  });

  it("default stress pools exclude sparse edge places", () => {
    const edgeIds = new Set(STRESS_START_POOL_EDGE.map((s) => s.id));
    expect(STRESS_START_POOL.some((s) => edgeIds.has(s.id))).toBe(false);

    for (const mode of ["mixed", "pool", "random"] as const) {
      const starts = pickStressStarts(3, 42, STRESS_START_POOL, mode);
      expect(starts.every((s) => !edgeIds.has(s.id))).toBe(true);
    }
  });

  it("pickStressStarts spreads starts ~40km apart when possible", () => {
    const starts = pickStressStarts(3, 11, STRESS_START_POOL, "random");
    expect(starts).toHaveLength(3);
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) *
          Math.cos(toRad(b.lat)) *
          Math.sin(dLng / 2) ** 2;
      return 2 * 6371 * Math.asin(Math.sqrt(h));
    };
    expect(km(starts[0]!.start, starts[1]!.start)).toBeGreaterThanOrEqual(35);
    expect(km(starts[0]!.start, starts[2]!.start)).toBeGreaterThanOrEqual(35);
    expect(km(starts[1]!.start, starts[2]!.start)).toBeGreaterThanOrEqual(35);
  });

  it("pickStressStarts random mode yields PL points", () => {
    const starts = pickStressStarts(3, 42, STRESS_START_POOL, "random");
    expect(starts).toHaveLength(3);
    expect(starts.every((s) => s.id.startsWith("rnd-"))).toBe(true);
    for (const s of starts) {
      expect(s.start.lat).toBeGreaterThan(49);
      expect(s.start.lat).toBeLessThan(55);
      expect(s.start.lng).toBeGreaterThan(14);
      expect(s.start.lng).toBeLessThan(25);
    }
  });

  it("pickStressStarts mixed mode prefers named places (~⅔)", () => {
    const starts = pickStressStarts(3, 99, STRESS_START_POOL, "mixed");
    expect(starts).toHaveLength(3);
    const named = starts.filter((s) => !s.id.startsWith("rnd-"));
    const random = starts.filter((s) => s.id.startsWith("rnd-"));
    expect(named.length).toBeGreaterThanOrEqual(2);
    expect(random.length).toBeGreaterThanOrEqual(1);
  });

  it("includeEdge adds sparse starts to stress matrix pool picks", () => {
    const withEdge = buildStressRouteScenarios({
      startCount: 8,
      distancesKm: [20],
      seed: 3,
      placesMode: "pool",
      includeEdge: true,
    });
    const placeIds = new Set(withEdge.map((s) => s.placeId));
    expect(
      STRESS_START_POOL_EDGE.some((edge) => placeIds.has(edge.id)),
    ).toBe(true);
  });
});
