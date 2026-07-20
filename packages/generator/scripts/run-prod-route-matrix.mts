#!/usr/bin/env node
/**
 * Full UI route matrix against the configured BRouter (prefer production via
 * BROUTER_URL): every bike × podprofil × toggles (unikaj asfaltu / spokojne /
 * dojazd), then audit geometry + densified GPX.
 *
 * Live progress + running scoreboard are printed as scenarios finish.
 *
 *   pnpm test:prod                         # full matrix (~72)
 *   LOOPFORGE_MATRIX=core pnpm test:prod   # smoke: 12 bike×profile defaults
 *   LOOPFORGE_SAVE_GPX=1 pnpm test:prod
 *   LOOPFORGE_SCENARIOS=gravel-flow-avoid,road-fast-quiet pnpm test:prod
 *
 * Loads BROUTER_URL from apps/web/.env.local when not already set in the shell.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RouteGenerationProgress } from "@loopforge/osm-types";
import {
  ensureBrouterServer,
  getBrouterConfig,
  isBrouterConfigured,
} from "@loopforge/brouter";
import {
  resolveLiveRouteScenarios,
  runLiveRouteScenario,
  scenarioDisplayName,
  type ScenarioRunResult,
} from "../src/route-quality.scenarios.js";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnvFile(resolve(repoRoot, "apps/web/.env.local"));
loadEnvFile(resolve(repoRoot, "apps/web/.env"));
loadEnvFile(resolve(repoRoot, ".env.local"));
loadEnvFile(resolve(repoRoot, ".env"));

const ENABLE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  reset: ENABLE_COLOR ? "\u001b[0m" : "",
  dim: ENABLE_COLOR ? "\u001b[2m" : "",
  bold: ENABLE_COLOR ? "\u001b[1m" : "",
  green: ENABLE_COLOR ? "\u001b[32m" : "",
  red: ENABLE_COLOR ? "\u001b[31m" : "",
  yellow: ENABLE_COLOR ? "\u001b[33m" : "",
  cyan: ENABLE_COLOR ? "\u001b[36m" : "",
};

function pad(s: string, n: number): string {
  return s.padEnd(n).slice(0, n);
}

function fmtSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function progressBar(pct: number, width = 20): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${clamped
    .toFixed(0)
    .padStart(3)}%`;
}

function printScoreboard(results: ScenarioRunResult[], title: string): void {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log("");
  console.log(
    `${c.bold}${title}${c.reset}  ${c.green}${passed} pass${c.reset} · ${c.red}${failed} fail${c.reset} · ${results.length} done`,
  );
  console.log(
    `${c.dim}${pad("status", 6)} ${pad("scenario", 36)} ${pad("km", 6)} ${pad("gpx", 6)} time${c.reset}`,
  );
  for (const r of results) {
    const status = r.ok
      ? `${c.green}PASS${c.reset} `
      : `${c.red}FAIL${c.reset} `;
    console.log(
      `${status} ${pad(scenarioDisplayName(r.scenario), 36)} ${pad(
        r.distanceKm != null ? r.distanceKm.toFixed(1) : "-",
        6,
      )} ${pad(r.gpxPoints != null ? String(r.gpxPoints) : "-", 6)} ${fmtSec(r.durationMs)}`,
    );
  }
  console.log("");
}

function createProgressPrinter(scenarioLabel: string, index: number, total: number) {
  let lastLine = "";
  let lastWriteAt = 0;
  const started = Date.now();

  const writeStatus = (text: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastWriteAt < 120 && text === lastLine) return;
    lastWriteAt = now;
    lastLine = text;
    const prefix = `${c.cyan}[${index}/${total}]${c.reset} ${scenarioLabel}`;
    const elapsed = `${c.dim}${fmtSec(now - started)}${c.reset}`;
    if (process.stdout.isTTY) {
      process.stdout.write(`\r\u001b[2K${prefix}  ${text}  ${elapsed}`);
    } else {
      console.log(`${prefix}  ${text}  ${elapsed}`);
    }
  };

  return {
    onProgress(progress: RouteGenerationProgress) {
      const variant =
        progress.variantIndex != null && progress.variantTotal != null
          ? ` v${progress.variantIndex}/${progress.variantTotal}`
          : "";
      const detail = progress.detail ? ` — ${progress.detail}` : "";
      writeStatus(
        `${progressBar(progress.progress)} ${progress.phase}${variant}: ${progress.message}${detail}`,
      );
    },
    onPhase(phase: "generate" | "audit-geometry" | "audit-gpx" | "audit-onpath") {
      if (phase === "generate") {
        writeStatus(`${progressBar(0)} generate: start`, true);
      } else if (phase === "audit-geometry") {
        writeStatus(`${progressBar(90)} audit: geometria + tagi + sieć`, true);
      } else if (phase === "audit-gpx") {
        writeStatus(`${progressBar(94)} audit: GPX`, true);
      } else {
        writeStatus(`${progressBar(97)} audit: długie krawędzie vs BRouter`, true);
      }
    },
    finish(result: ScenarioRunResult) {
      if (process.stdout.isTTY) process.stdout.write("\r\u001b[2K");
      const mark = result.ok
        ? `${c.green}✓ PASS${c.reset}`
        : `${c.red}✗ FAIL${c.reset}`;
      const stats = result.ok
        ? `${result.distanceKm?.toFixed(1)} km · ${result.gpxPoints} pkt GPX · ${fmtSec(result.durationMs)}`
        : fmtSec(result.durationMs);
      console.log(
        `${c.cyan}[${index}/${total}]${c.reset} ${mark}  ${scenarioLabel}  ${c.dim}${stats}${c.reset}`,
      );
      if (!result.ok && result.error) {
        for (const line of result.error.split("\n")) {
          console.log(`  ${c.red}|${c.reset} ${line}`);
        }
      }
    },
  };
}

async function main(): Promise<void> {
  if (!isBrouterConfigured()) {
    console.error(
      "BRouter not configured. Set BROUTER_URL (production) or install local segments.",
    );
    process.exit(2);
  }

  const config = getBrouterConfig()!;
  console.log("");
  console.log(`${c.bold}Loopforge route matrix${c.reset}`);
  console.log(`${c.dim}BRouter${c.reset}  ${config.baseUrl}`);

  process.stdout.write(`${c.dim}Sprawdzam BRouter…${c.reset} `);
  const probeStarted = Date.now();
  await ensureBrouterServer(config);
  console.log(`${c.green}OK${c.reset} ${c.dim}(${fmtSec(Date.now() - probeStarted)})${c.reset}`);

  const matrixEnv = (process.env.LOOPFORGE_MATRIX ?? "full").toLowerCase();
  const matrix: "full" | "core" = matrixEnv === "core" ? "core" : "full";
  const filter = process.env.LOOPFORGE_SCENARIOS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Explicit id filter always resolves against the full UI catalog.
  const catalog = resolveLiveRouteScenarios(filter?.length ? "full" : matrix);

  const scenarios = filter?.length
    ? catalog.filter((s) => filter.includes(s.id))
    : catalog;

  if (scenarios.length === 0) {
    console.error("No scenarios matched LOOPFORGE_SCENARIOS / LOOPFORGE_MATRIX");
    process.exit(2);
  }

  const saveGpx = process.env.LOOPFORGE_SAVE_GPX === "1";
  const outDir = resolve(
    process.cwd(),
    process.env.LOOPFORGE_GPX_DIR ?? ".route-test-artifacts",
  );
  if (saveGpx) mkdirSync(outDir, { recursive: true });

  const idPreview =
    scenarios.length <= 16
      ? scenarios.map((s) => s.id).join(", ")
      : `${scenarios
          .slice(0, 8)
          .map((s) => s.id)
          .join(", ")} … +${scenarios.length - 8} more`;
  console.log(
    `${c.dim}Matryca${c.reset}     ${filter?.length ? `filter → full` : matrix} (${catalog.length} w katalogu)`,
  );
  console.log(
    `${c.dim}Scenariusze${c.reset}  ${scenarios.length}  ${c.dim}(${idPreview})${c.reset}`,
  );
  if (saveGpx) {
    console.log(`${c.dim}GPX →${c.reset}  ${outDir}`);
  }
  console.log("");

  const results: ScenarioRunResult[] = [];
  const matrixStarted = Date.now();

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]!;
    const printer = createProgressPrinter(
      scenario.label,
      i + 1,
      scenarios.length,
    );

    const result = await runLiveRouteScenario(scenario, {
      onProgress: (p) => printer.onProgress(p),
      onPhase: (phase) => printer.onPhase(phase),
    });
    results.push(result);
    printer.finish(result);

    if (saveGpx && result.gpx) {
      const path = resolve(outDir, `${scenario.id}.gpx`);
      writeFileSync(path, result.gpx, "utf8");
      console.log(`  ${c.dim}saved ${path}${c.reset}`);
    }

    // Running report after every scenario so failures are visible immediately.
    printScoreboard(
      results,
      `Wstępny raport (${i + 1}/${scenarios.length})`,
    );
  }

  printScoreboard(results, "Raport końcowy");
  const failed = results.filter((r) => !r.ok);
  const totalSec = fmtSec(Date.now() - matrixStarted);
  if (failed.length === 0) {
    console.log(
      `${c.green}${c.bold}Wszystkie scenariusze OK${c.reset}  ${c.dim}${results.length} w ${totalSec}${c.reset}`,
    );
  } else {
    console.log(
      `${c.red}${c.bold}${failed.length} nieudanych${c.reset}  ${c.dim}${results.length - failed.length}/${results.length} OK · ${totalSec}${c.reset}`,
    );
    console.log(`${c.dim}Nieudane:${c.reset} ${failed.map((r) => r.scenario.id).join(", ")}`);
  }
  console.log("");
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
