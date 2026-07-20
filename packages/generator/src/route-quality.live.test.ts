import { describe, expect, it } from "vitest";
import {
  ensureBrouterServer,
  getBrouterConfig,
  isBrouterConfigured,
} from "@loopforge/brouter";
import { generateRoute } from "./index";
import { auditRouteGeometry, formatRouteQualityReport } from "./route-quality";

const config = isBrouterConfigured() ? getBrouterConfig() : null;
const enabled = process.env.LOOPFORGE_LIVE_ROUTES === "1" && config != null;

/**
 * Live generation quality gates.
 *
 *   pnpm brouter   # terminal 1
 *   LOOPFORGE_LIVE_ROUTES=1 pnpm --filter @loopforge/generator test:live
 */
describe.skipIf(!enabled)("live loop generation quality", () => {
  it(
    "starts BRouter when configured locally",
    async () => {
      await ensureBrouterServer(config!);
    },
    90_000,
  );

  it(
    "rural gravel loop near Klembów stays continuous without spurs",
    async () => {
      await ensureBrouterServer(config!);
      const route = await generateRoute({
        start: { lat: 52.39225, lng: 21.34062 },
        bikeType: "gravel",
        distanceKm: 25,
        direction: "NE",
        avoidAsphalt: true,
        approachEnabled: false,
      });

      const coordinates = route.geojson.geometry.coordinates as [
        number,
        number,
      ][];
      const audit = auditRouteGeometry(coordinates, {
        targetDistanceKm: 25,
        actualDistanceKm: route.metrics.distanceKm,
        allowApproachMirror: false,
        geometryContext: { start: { lat: 52.39225, lng: 21.34062 } },
      });

      expect(audit.ok, formatRouteQualityReport(audit)).toBe(true);
      expect(route.metrics.distanceKm).toBeGreaterThan(15);
    },
    180_000,
  );

  it(
    "Warsaw urban loop has no long spurs or teleports",
    async () => {
      await ensureBrouterServer(config!);
      const route = await generateRoute({
        start: { lat: 52.2297, lng: 21.0122 },
        bikeType: "road",
        distanceKm: 20,
        direction: "W",
        preferQuietRoutes: true,
        approachEnabled: false,
      });

      const coordinates = route.geojson.geometry.coordinates as [
        number,
        number,
      ][];
      const audit = auditRouteGeometry(coordinates, {
        targetDistanceKm: 20,
        actualDistanceKm: route.metrics.distanceKm,
        allowApproachMirror: false,
        geometryContext: {
          start: { lat: 52.2297, lng: 21.0122 },
          urban: true,
        },
      });

      expect(audit.ok, formatRouteQualityReport(audit)).toBe(true);
    },
    180_000,
  );
});
