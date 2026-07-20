import type {
  BikeType,
  Direction,
  GenerateRouteRequest,
  LatLng,
  RideProfile,
  RouteGenerationProgress,
} from "@loopforge/osm-types";
import {
  getRideProfileLabel,
  getRideProfileOptions,
  RIDE_PROFILE_OPTIONS,
} from "@loopforge/osm-types";
import { parseGpxTrackCoordinates } from "@loopforge/gpx";
import { generateRoute } from "./index";
import {
  auditRouteGeometry,
  formatRouteQualityReport,
  type RouteQualityAudit,
} from "./route-quality";

/** Rural Mazowsze — gravel / MTB / general. */
export const START_RURAL: LatLng = { lat: 52.39225, lng: 21.34062 };

/** Warsaw — Ochota / Filtry edge: still metro, less one-way maze than Śródmieście. */
export const START_URBAN: LatLng = { lat: 52.2118, lng: 20.9815 };

const APPROACH_DISTANCE_KM = 8;

const DIRECTIONS: Direction[] = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
];

/** Base loop lengths matching sensible UI defaults per bike × profile. */
const DISTANCE_KM: Record<BikeType, Record<RideProfile, number>> = {
  gravel: { flow: 25, technical: 25, fast: 30 },
  road: { flow: 20, technical: 18, fast: 25 },
  mtb: { flow: 22, technical: 20, fast: 25 },
  general: { flow: 25, technical: 25, fast: 25 },
};

export type LiveRouteScenario = {
  id: string;
  label: string;
  request: GenerateRouteRequest;
  /** Urban geometry context for teleport thresholds. */
  urban?: boolean;
};

type ToggleCombo = {
  avoidAsphalt: boolean;
  preferQuietRoutes: boolean;
  approachEnabled: boolean;
};

function supportsAvoidAsphalt(bikeType: BikeType): boolean {
  return bikeType === "gravel" || bikeType === "mtb";
}

function toggleCombos(bikeType: BikeType): ToggleCombo[] {
  const avoidStates = supportsAvoidAsphalt(bikeType) ? [false, true] : [false];
  const quietStates = [false, true];
  const approachStates = [false, true];
  const out: ToggleCombo[] = [];
  for (const avoidAsphalt of avoidStates) {
    for (const preferQuietRoutes of quietStates) {
      for (const approachEnabled of approachStates) {
        out.push({ avoidAsphalt, preferQuietRoutes, approachEnabled });
      }
    }
  }
  return out;
}

function scenarioId(
  bikeType: BikeType,
  profile: RideProfile,
  toggles: ToggleCombo,
): string {
  const parts = [bikeType, profile];
  if (toggles.avoidAsphalt) parts.push("avoid");
  if (toggles.preferQuietRoutes) parts.push("quiet");
  if (toggles.approachEnabled) parts.push("approach");
  return parts.join("-");
}

function scenarioLabel(
  bikeType: BikeType,
  profile: RideProfile,
  toggles: ToggleCombo,
): string {
  const bikeLabel =
    bikeType === "road"
      ? "Szosa"
      : bikeType === "mtb"
        ? "MTB"
        : bikeType === "general"
          ? "Ogólny"
          : "Gravel";
  const profileLabel =
    getRideProfileLabel(bikeType, profile) ?? profile;
  const flags: string[] = [];
  if (toggles.avoidAsphalt) flags.push("unikaj asfaltu");
  if (toggles.preferQuietRoutes) flags.push("spokojne");
  if (toggles.approachEnabled) flags.push("dojazd");
  return flags.length > 0
    ? `${bikeLabel} · ${profileLabel} · ${flags.join(" · ")}`
    : `${bikeLabel} · ${profileLabel}`;
}

function buildScenario(
  bikeType: BikeType,
  profile: RideProfile,
  toggles: ToggleCombo,
  index: number,
): LiveRouteScenario {
  const urban = bikeType === "road";
  const start = urban ? START_URBAN : START_RURAL;
  let distanceKm = DISTANCE_KM[bikeType][profile];
  // Keep approach runs closer to target length / wall-clock.
  if (toggles.approachEnabled) {
    distanceKm = Math.max(15, Math.round(distanceKm * 0.8));
  }

  const id = scenarioId(bikeType, profile, toggles);
  const label = scenarioLabel(bikeType, profile, toggles);
  const direction = DIRECTIONS[index % DIRECTIONS.length]!;

  return {
    id,
    label,
    urban,
    request: {
      start,
      bikeType,
      profile,
      distanceKm,
      direction,
      avoidAsphalt: supportsAvoidAsphalt(bikeType)
        ? toggles.avoidAsphalt
        : undefined,
      preferQuietRoutes: toggles.preferQuietRoutes || undefined,
      approachEnabled: toggles.approachEnabled || undefined,
      approachDistanceKm: toggles.approachEnabled
        ? APPROACH_DISTANCE_KM
        : undefined,
    },
  };
}

/**
 * Full product UI matrix: every bike × podprofil × toggles visible in the form.
 *
 * - Unikaj asfaltu: gravel + MTB only
 * - Ścieżki i spokojne drogi: all bikes
 * - Dojazd do pętli: all bikes (~8 km)
 *
 * Count: gravel 24 + mtb 24 + road 12 + general 12 = 72
 */
export function buildLiveRouteScenarios(): LiveRouteScenario[] {
  const scenarios: LiveRouteScenario[] = [];
  let index = 0;
  for (const bikeType of Object.keys(RIDE_PROFILE_OPTIONS) as BikeType[]) {
    for (const option of getRideProfileOptions(bikeType)) {
      for (const toggles of toggleCombos(bikeType)) {
        scenarios.push(buildScenario(bikeType, option.value, toggles, index));
        index += 1;
      }
    }
  }
  return scenarios;
}

/**
 * Compact smoke set: one row per bike × profile with typical default toggles
 * (gravel/MTB avoid asphalt on; road quiet only on Spokojny/Boczne).
 */
export function buildCoreRouteScenarios(): LiveRouteScenario[] {
  const cores: Array<{
    bikeType: BikeType;
    profile: RideProfile;
    avoidAsphalt?: boolean;
    preferQuietRoutes?: boolean;
  }> = [
    { bikeType: "gravel", profile: "flow", avoidAsphalt: true },
    { bikeType: "gravel", profile: "technical", avoidAsphalt: true },
    { bikeType: "gravel", profile: "fast", avoidAsphalt: true },
    { bikeType: "road", profile: "fast" },
    { bikeType: "road", profile: "flow", preferQuietRoutes: true },
    { bikeType: "road", profile: "technical", preferQuietRoutes: true },
    { bikeType: "mtb", profile: "flow", avoidAsphalt: true },
    { bikeType: "mtb", profile: "technical", avoidAsphalt: true },
    { bikeType: "mtb", profile: "fast", avoidAsphalt: true },
    { bikeType: "general", profile: "flow" },
    { bikeType: "general", profile: "technical", avoidAsphalt: true },
    { bikeType: "general", profile: "fast" },
  ];

  return cores.map((core, index) =>
    buildScenario(
      core.bikeType,
      core.profile,
      {
        avoidAsphalt: Boolean(core.avoidAsphalt),
        preferQuietRoutes: Boolean(core.preferQuietRoutes),
        approachEnabled: false,
      },
      index,
    ),
  );
}

/** Default: full UI matrix (72). Use LOOPFORGE_MATRIX=core for the 12 smoke rows. */
export const LIVE_ROUTE_SCENARIOS: LiveRouteScenario[] =
  buildLiveRouteScenarios();

export const LIVE_ROUTE_SCENARIOS_CORE: LiveRouteScenario[] =
  buildCoreRouteScenarios();

export function resolveLiveRouteScenarios(
  matrix: "full" | "core" = "full",
): LiveRouteScenario[] {
  return matrix === "core" ? LIVE_ROUTE_SCENARIOS_CORE : LIVE_ROUTE_SCENARIOS;
}

export type ScenarioRunResult = {
  scenario: LiveRouteScenario;
  ok: boolean;
  error?: string;
  distanceKm?: number;
  gpxPoints?: number;
  geometryAudit?: RouteQualityAudit;
  gpxAudit?: RouteQualityAudit;
  durationMs: number;
  gpx?: string;
};

export type RunLiveRouteScenarioOptions = {
  onProgress?: (progress: RouteGenerationProgress) => void;
  onPhase?: (phase: "generate" | "audit-geometry" | "audit-gpx") => void;
};

/**
 * Generate one loop on the configured BRouter, then audit both the polyline
 * and densified GPX independently.
 */
export async function runLiveRouteScenario(
  scenario: LiveRouteScenario,
  options: RunLiveRouteScenarioOptions = {},
): Promise<ScenarioRunResult> {
  const started = Date.now();
  const approach = Boolean(scenario.request.approachEnabled);
  try {
    options.onPhase?.("generate");
    const route = await generateRoute(scenario.request, {
      onProgress: options.onProgress,
    });
    const coordinates = route.geojson.geometry.coordinates as [
      number,
      number,
    ][];
    const gpxCoords = parseGpxTrackCoordinates(route.gpx);

    const auditOpts = {
      targetDistanceKm: scenario.request.distanceKm,
      actualDistanceKm: route.metrics.distanceKm,
      allowApproachMirror: approach,
      geometryContext: {
        start: scenario.request.start,
        urban: scenario.urban,
      },
    };

    options.onPhase?.("audit-geometry");
    const geometryAudit = auditRouteGeometry(coordinates, {
      ...auditOpts,
      // Approach GPX is dojazd + loop + return: spur/backtrack of the full
      // polyline are dominated by the intentional out-and-back. Loop quality
      // was already gated inside generateRoute; here only continuity matters.
      maxSpurShare: approach ? 1 : scenario.urban ? 0.14 : 0.08,
      maxBacktrack: approach ? 1 : scenario.urban ? 0.2 : 0.09,
      maxMirroredPrefixM: approach ? 25_000 : 800,
    });
    options.onPhase?.("audit-gpx");
    // Densified GPX (~5 m) wildly inflates spur/backtrack — only enforce
    // continuity (and allow dojazd mirror when approach is on).
    const gpxAudit = auditRouteGeometry(gpxCoords, {
      ...auditOpts,
      actualDistanceKm: undefined,
      maxSpurShare: 1,
      maxBacktrack: 1,
      maxMirroredPrefixM: approach ? 25_000 : 800,
      failOnRemainingSpurs: false,
    });

    const ok = geometryAudit.ok && gpxAudit.ok && gpxCoords.length >= 50;

    return {
      scenario,
      ok,
      distanceKm: route.metrics.distanceKm,
      gpxPoints: gpxCoords.length,
      geometryAudit,
      gpxAudit,
      durationMs: Date.now() - started,
      gpx: route.gpx,
      error: ok
        ? undefined
        : [
            !geometryAudit.ok
              ? `geometry:\n${formatRouteQualityReport(geometryAudit)}`
              : null,
            !gpxAudit.ok
              ? `gpx:\n${formatRouteQualityReport(gpxAudit)}`
              : null,
            gpxCoords.length < 50
              ? `gpx too few points (${gpxCoords.length})`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
    };
  } catch (err) {
    return {
      scenario,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

export function scenarioDisplayName(scenario: LiveRouteScenario): string {
  const profile = getRideProfileLabel(
    scenario.request.bikeType,
    scenario.request.profile,
  );
  const base = profile
    ? `${scenario.request.bikeType}/${profile}`
    : scenario.label;
  const flags: string[] = [];
  if (scenario.request.avoidAsphalt) flags.push("A");
  if (scenario.request.preferQuietRoutes) flags.push("Q");
  if (scenario.request.approachEnabled) flags.push("D");
  return flags.length > 0 ? `${base} +${flags.join("")}` : base;
}
