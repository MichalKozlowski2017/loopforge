import { describe, expect, it, beforeAll } from "vitest";
import {
  ensureBrouterServer,
  getBrouterConfig,
  isBrouterConfigured,
} from "@loopforge/brouter";
import {
  LIVE_ROUTE_SCENARIOS,
  runLiveRouteScenario,
} from "./route-quality.scenarios";

const config = isBrouterConfigured() ? getBrouterConfig() : null;

/**
 * Opt-in live matrix against configured BRouter (local or production).
 *
 * Production:
 *   BROUTER_URL=https://router… LOOPFORGE_LIVE_ROUTES=1 pnpm test:live
 *
 * Subset:
 *   LOOPFORGE_SCENARIOS=gravel-balans,mtb-xc LOOPFORGE_LIVE_ROUTES=1 pnpm test:live
 *
 * Prefer the CLI for a readable report:
 *   BROUTER_URL=… pnpm test:prod
 */
const enabled = process.env.LOOPFORGE_LIVE_ROUTES === "1" && config != null;

const filter = process.env.LOOPFORGE_SCENARIOS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const scenarios = filter?.length
  ? LIVE_ROUTE_SCENARIOS.filter((s) => filter.includes(s.id))
  : LIVE_ROUTE_SCENARIOS;

describe.skipIf(!enabled)("production BRouter loop matrix", () => {
  beforeAll(async () => {
    await ensureBrouterServer(config!);
  }, 90_000);

  it.each(scenarios)(
    "$label generates a clean loop and GPX ($id)",
    async (scenario) => {
      const result = await runLiveRouteScenario(scenario);
      expect(result.ok, result.error ?? "unknown failure").toBe(true);
      expect(result.distanceKm ?? 0).toBeGreaterThan(
        scenario.request.distanceKm * 0.45,
      );
      expect(result.gpxPoints ?? 0).toBeGreaterThan(50);
    },
    180_000,
  );
});
