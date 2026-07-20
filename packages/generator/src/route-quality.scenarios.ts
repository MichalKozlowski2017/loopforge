import type {
  BikeType,
  Direction,
  GenerateRouteRequest,
  LatLng,
  RideProfile,
  RouteGenerationProgress,
} from "@loopforge/osm-types";
import { getRideProfileLabel } from "@loopforge/osm-types";
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

export type LiveRouteScenario = {
  id: string;
  label: string;
  request: GenerateRouteRequest;
  /** Urban geometry context for teleport thresholds. */
  urban?: boolean;
};

/**
 * Full product matrix: every bike type × ride profile used in the UI.
 * Runs against whatever BRouter BROUTER_URL / local config points at.
 */
export const LIVE_ROUTE_SCENARIOS: LiveRouteScenario[] = [
  // Gravel
  scenario("gravel-balans", "Gravel · Balans", {
    start: START_RURAL,
    bikeType: "gravel",
    profile: "flow",
    distanceKm: 25,
    direction: "NE",
    avoidAsphalt: true,
  }),
  scenario("gravel-eksploracyjny", "Gravel · Eksploracyjny", {
    start: START_RURAL,
    bikeType: "gravel",
    profile: "technical",
    distanceKm: 25,
    direction: "N",
    avoidAsphalt: true,
  }),
  scenario("gravel-express", "Gravel · Express", {
    start: START_RURAL,
    bikeType: "gravel",
    profile: "fast",
    distanceKm: 30,
    direction: "E",
    avoidAsphalt: true,
  }),
  // Szosa
  scenario("road-szybki", "Szosa · Szybki", {
    start: START_URBAN,
    bikeType: "road",
    profile: "fast",
    distanceKm: 25,
    direction: "W",
    preferQuietRoutes: false,
  }, true),
  scenario("road-spokojny", "Szosa · Spokojny", {
    start: START_URBAN,
    bikeType: "road",
    profile: "flow",
    distanceKm: 20,
    direction: "NW",
    preferQuietRoutes: true,
  }, true),
  scenario("road-boczne", "Szosa · Boczne drogi", {
    start: START_URBAN,
    bikeType: "road",
    profile: "technical",
    distanceKm: 18,
    direction: "SW",
    preferQuietRoutes: true,
  }, true),
  // MTB
  scenario("mtb-flow", "MTB · Flow", {
    start: START_RURAL,
    bikeType: "mtb",
    profile: "flow",
    distanceKm: 22,
    direction: "SE",
    avoidAsphalt: true,
  }),
  scenario("mtb-trail", "MTB · Trail", {
    start: START_RURAL,
    bikeType: "mtb",
    profile: "technical",
    distanceKm: 20,
    direction: "S",
    avoidAsphalt: true,
  }),
  scenario("mtb-xc", "MTB · XC", {
    start: START_RURAL,
    bikeType: "mtb",
    profile: "fast",
    distanceKm: 25,
    direction: "NE",
    avoidAsphalt: true,
  }),
  // Ogólny
  scenario("general-turystyczny", "Ogólny · Turystyczny", {
    start: START_RURAL,
    bikeType: "general",
    profile: "flow",
    distanceKm: 25,
    direction: "E",
  }),
  scenario("general-terenowy", "Ogólny · Terenowy", {
    start: START_RURAL,
    bikeType: "general",
    profile: "technical",
    distanceKm: 25,
    direction: "N",
    avoidAsphalt: true,
  }),
  scenario("general-asfalt", "Ogólny · Asfalt", {
    start: START_RURAL,
    bikeType: "general",
    profile: "fast",
    distanceKm: 25,
    direction: "W",
  }),
];

function scenario(
  id: string,
  label: string,
  partial: {
    start: LatLng;
    bikeType: BikeType;
    profile: RideProfile;
    distanceKm: number;
    direction: Direction;
    avoidAsphalt?: boolean;
    preferQuietRoutes?: boolean;
  },
  urban = false,
): LiveRouteScenario {
  return {
    id,
    label,
    urban,
    request: {
      start: partial.start,
      bikeType: partial.bikeType,
      profile: partial.profile,
      distanceKm: partial.distanceKm,
      direction: partial.direction,
      avoidAsphalt: partial.avoidAsphalt,
      preferQuietRoutes: partial.preferQuietRoutes,
      approachEnabled: false,
    },
  };
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
      allowApproachMirror: false,
      geometryContext: {
        start: scenario.request.start,
        urban: scenario.urban,
      },
    };

    options.onPhase?.("audit-geometry");
    const geometryAudit = auditRouteGeometry(coordinates, {
      ...auditOpts,
      // Align with generator deliverable ceilings (relaxed / urban).
      maxSpurShare: scenario.urban ? 0.14 : 0.08,
      maxBacktrack: scenario.urban ? 0.2 : 0.09,
      maxMirroredPrefixM: 800,
    });
    options.onPhase?.("audit-gpx");
    // Densified GPX (~5 m) wildly inflates spur/backtrack — only enforce
    // continuity / mirrored out-and-back there.
    const gpxAudit = auditRouteGeometry(gpxCoords, {
      ...auditOpts,
      actualDistanceKm: undefined,
      maxSpurShare: 1,
      maxBacktrack: 1,
      maxMirroredPrefixM: 800,
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
  return profile
    ? `${scenario.request.bikeType}/${profile}`
    : scenario.label;
}
