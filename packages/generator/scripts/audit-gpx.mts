#!/usr/bin/env node
/**
 * Audit a Loopforge GPX (or any track) for teleports, spurs, backtrack, mirror.
 *
 *   pnpm --filter @loopforge/generator audit-gpx -- ~/Downloads/loopforge-….gpx
 *   pnpm --filter @loopforge/generator audit-gpx -- --approach ~/Downloads/….gpx
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseGpxTrackCoordinates } from "@loopforge/gpx";
import {
  auditRouteGeometry,
  formatRouteQualityReport,
} from "../src/route-quality.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const allowApproach = args.includes("--approach");
const file = args.find((a) => !a.startsWith("--"));

if (!file) {
  console.error(
    "Usage: audit-gpx [--approach] <file.gpx>\n  --approach  allow mirrored dojazd/powrót",
  );
  process.exit(2);
}

const xml = readFileSync(resolve(file), "utf8");
const coordinates = parseGpxTrackCoordinates(xml);
if (coordinates.length < 2) {
  console.error("No track points found in", file);
  process.exit(2);
}

const audit = auditRouteGeometry(coordinates, {
  allowApproachMirror: allowApproach,
  failOnRemainingSpurs: false,
});

console.log(formatRouteQualityReport(audit));
console.log(`  points=${coordinates.length} file=${file}`);
process.exit(audit.ok ? 0 : 1);
