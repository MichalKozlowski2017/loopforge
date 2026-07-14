import type { BikeType, RideProfile } from "./index";

export interface RideProfileLoopPrefs {
  /** Multiplier on estimated road detour (higher = wider / quieter loop plan). */
  detourMultiplier: number;
  /** Extra degrees on arc half-width. */
  arcWidthExtraDeg: number;
  /** Extra lateral share on longitudinal loops. */
  lateralShareExtra: number;
  /** Adjust waypoint count (−1…+1). */
  pointCountAdjust: number;
  /** Reach multiplier for arc radius. */
  reachBoost: number;
  /** Target paved share when picking the best variant (0–1). */
  targetPavedShare?: number;
  /** Target off-road share when picking the best variant (0–1). */
  targetOffroadShare?: number;
  /** Penalty weight for surface mismatch in variant selection. */
  surfaceMismatchWeight: number;
  /** Bias loop shape planning. */
  shapeBias: "arc" | "longitudinal" | "balanced";
}

const NEUTRAL: RideProfileLoopPrefs = {
  detourMultiplier: 1,
  arcWidthExtraDeg: 0,
  lateralShareExtra: 0,
  pointCountAdjust: 0,
  reachBoost: 1,
  surfaceMismatchWeight: 0,
  shapeBias: "balanced",
};

const ROAD: Record<RideProfile, RideProfileLoopPrefs> = {
  fast: {
    detourMultiplier: 0.86,
    arcWidthExtraDeg: -12,
    lateralShareExtra: -0.018,
    pointCountAdjust: -1,
    reachBoost: 0.96,
    targetPavedShare: 0.84,
    surfaceMismatchWeight: 22,
    shapeBias: "longitudinal",
  },
  flow: {
    detourMultiplier: 1.06,
    arcWidthExtraDeg: 4,
    lateralShareExtra: 0.008,
    pointCountAdjust: 0,
    reachBoost: 1.02,
    targetPavedShare: 0.72,
    surfaceMismatchWeight: 18,
    shapeBias: "balanced",
  },
  technical: {
    detourMultiplier: 1.3,
    arcWidthExtraDeg: 16,
    lateralShareExtra: 0.028,
    pointCountAdjust: 1,
    reachBoost: 1.08,
    targetPavedShare: 0.5,
    surfaceMismatchWeight: 26,
    shapeBias: "arc",
  },
};

const GRAVEL: Record<RideProfile, RideProfileLoopPrefs> = {
  flow: {
    detourMultiplier: 1.1,
    arcWidthExtraDeg: 6,
    lateralShareExtra: 0.012,
    pointCountAdjust: 0,
    reachBoost: 1.04,
    targetPavedShare: 0.3,
    targetOffroadShare: 0.5,
    surfaceMismatchWeight: 22,
    shapeBias: "balanced",
  },
  technical: {
    detourMultiplier: 1.36,
    arcWidthExtraDeg: 18,
    lateralShareExtra: 0.034,
    pointCountAdjust: 1,
    reachBoost: 1.1,
    targetPavedShare: 0.1,
    targetOffroadShare: 0.7,
    surfaceMismatchWeight: 30,
    shapeBias: "arc",
  },
  fast: {
    detourMultiplier: 0.94,
    arcWidthExtraDeg: 0,
    lateralShareExtra: 0.004,
    pointCountAdjust: 0,
    reachBoost: 1.0,
    targetPavedShare: 0.18,
    targetOffroadShare: 0.62,
    surfaceMismatchWeight: 32,
    shapeBias: "longitudinal",
  },
};

const MTB: Record<RideProfile, RideProfileLoopPrefs> = {
  flow: {
    detourMultiplier: 1.14,
    arcWidthExtraDeg: 8,
    lateralShareExtra: 0.014,
    pointCountAdjust: 0,
    reachBoost: 1.05,
    targetPavedShare: 0.08,
    targetOffroadShare: 0.58,
    surfaceMismatchWeight: 20,
    shapeBias: "balanced",
  },
  technical: {
    detourMultiplier: 1.4,
    arcWidthExtraDeg: 20,
    lateralShareExtra: 0.038,
    pointCountAdjust: 1,
    reachBoost: 1.12,
    targetPavedShare: 0.04,
    targetOffroadShare: 0.78,
    surfaceMismatchWeight: 32,
    shapeBias: "arc",
  },
  fast: {
    detourMultiplier: 0.92,
    arcWidthExtraDeg: -2,
    lateralShareExtra: -0.006,
    pointCountAdjust: -1,
    reachBoost: 0.97,
    targetPavedShare: 0.2,
    targetOffroadShare: 0.38,
    surfaceMismatchWeight: 18,
    shapeBias: "longitudinal",
  },
};

const GENERAL: Record<RideProfile, RideProfileLoopPrefs> = {
  flow: {
    detourMultiplier: 1.08,
    arcWidthExtraDeg: 5,
    lateralShareExtra: 0.01,
    pointCountAdjust: 0,
    reachBoost: 1.03,
    targetPavedShare: 0.38,
    targetOffroadShare: 0.42,
    surfaceMismatchWeight: 18,
    shapeBias: "balanced",
  },
  technical: {
    detourMultiplier: 1.32,
    arcWidthExtraDeg: 14,
    lateralShareExtra: 0.03,
    pointCountAdjust: 1,
    reachBoost: 1.08,
    targetPavedShare: 0.14,
    targetOffroadShare: 0.62,
    surfaceMismatchWeight: 26,
    shapeBias: "arc",
  },
  fast: {
    detourMultiplier: 0.92,
    arcWidthExtraDeg: -3,
    lateralShareExtra: -0.007,
    pointCountAdjust: -1,
    reachBoost: 0.98,
    targetPavedShare: 0.58,
    targetOffroadShare: 0.24,
    surfaceMismatchWeight: 18,
    shapeBias: "longitudinal",
  },
};

const BY_BIKE: Record<BikeType, Record<RideProfile, RideProfileLoopPrefs>> = {
  road: ROAD,
  gravel: GRAVEL,
  mtb: MTB,
  general: GENERAL,
};

export function getRideProfileLoopPrefs(
  bikeType: BikeType,
  profile: RideProfile | undefined,
): RideProfileLoopPrefs {
  if (!profile) return NEUTRAL;
  return BY_BIKE[bikeType][profile] ?? NEUTRAL;
}

/** Squared deviation from target surface mix — lower is better. */
export function profileSurfaceMismatch(
  pavedShare: number,
  offroadShare: number,
  prefs: RideProfileLoopPrefs,
): number {
  let mismatch = 0;
  if (prefs.targetPavedShare !== undefined) {
    const delta = pavedShare - prefs.targetPavedShare;
    mismatch += delta * delta * prefs.surfaceMismatchWeight;
  }
  if (prefs.targetOffroadShare !== undefined) {
    const delta = offroadShare - prefs.targetOffroadShare;
    mismatch += delta * delta * prefs.surfaceMismatchWeight;
  }
  return mismatch;
}
