import { describe, expect, it } from "vitest";
import {
  auditGeneratedRoute,
  auditRouteGeometry,
  measureOffPath,
  mirroredPrefixLengthM,
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
});
