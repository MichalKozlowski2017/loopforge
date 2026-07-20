#!/usr/bin/env node
/**
 * Full UI route matrix against the configured BRouter (prefer production via
 * BROUTER_URL): every bike × podprofil × toggles (unikaj asfaltu / spokojne /
 * dojazd), then audit geometry + densified GPX + on-path checks.
 *
 * Live: one updating status line + one result line per scenario.
 * Full table only at the end.
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

const IS_TTY = process.stdout.isTTY === true;
const ENABLE_COLOR = IS_TTY && !process.env.NO_COLOR;
const c = {
  reset: ENABLE_COLOR ? "\u001b[0m" : "",
  dim: ENABLE_COLOR ? "\u001b[2m" : "",
  bold: ENABLE_COLOR ? "\u001b[1m" : "",
  green: ENABLE_COLOR ? "\u001b[32m" : "",
  red: ENABLE_COLOR ? "\u001b[31m" : "",
  yellow: ENABLE_COLOR ? "\u001b[33m" : "",
  cyan: ENABLE_COLOR ? "\u001b[36m" : "",
  magenta: ENABLE_COLOR ? "\u001b[35m" : "",
};

const COL = {
  status: 6,
  scenario: 34,
  km: 6,
  quality: 26,
  time: 7,
};

function pad(s: string, n: number): string {
  if (s.length <= n) return s.padEnd(n);
  if (n <= 1) return s.slice(0, n);
  return `${s.slice(0, n - 1)}…`;
}

function fmtSec(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

function progressBar(pct: number, width = 16): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function rule(char = "─", width = 72): string {
  return `${c.dim}${char.repeat(width)}${c.reset}`;
}

function phaseLabel(
  phase: RouteGenerationProgress["phase"] | "generate" | "audit-geometry" | "audit-gpx" | "audit-onpath",
): string {
  switch (phase) {
    case "planning":
      return "plan";
    case "approach":
      return "dojazd";
    case "variants":
      return "warianty";
    case "routing":
      return "routing";
    case "scoring":
      return "ocena";
    case "refining":
      return "korekta";
    case "finalizing":
      return "GPX";
    case "generate":
      return "start";
    case "audit-geometry":
      return "audit·sieć";
    case "audit-gpx":
      return "audit·gpx";
    case "audit-onpath":
      return "audit·drogi";
    default:
      return String(phase);
  }
}

function qualitySummary(result: ScenarioRunResult): string {
  const m = result.geometryAudit?.metrics;
  if (!m) return result.ok ? "—" : "gen fail";
  const spur = `${(m.spurShare * 100).toFixed(0)}%spur`;
  const off = `${(m.offPathShare * 100).toFixed(0)}%off`;
  const tags =
    m.wrongWaySegmentM > 0 || m.useSidepathSegmentM > 0
      ? ` · ${Math.round(m.wrongWaySegmentM + m.useSidepathSegmentM)}m tag`
      : "";
  return `${spur} ${off}${tags}`;
}

function shortError(result: ScenarioRunResult): string {
  if (!result.error) return "unknown failure";
  const findings = result.geometryAudit?.findings.filter(
    (f) => f.severity === "error",
  );
  if (findings && findings.length > 0) {
    return findings.map((f) => f.code).join(", ");
  }
  const first = result.error.split("\n").find((l) => l.trim().length > 0) ?? "";
  return first.replace(/^geometry:\s*/i, "").replace(/^FAIL route quality\s*/i, "").trim() ||
    result.error.slice(0, 120);
}

function printHeader(opts: {
  baseUrl: string;
  matrixLabel: string;
  catalogSize: number;
  scenarioCount: number;
  idPreview: string;
  saveGpxDir?: string;
}): void {
  console.log("");
  console.log(`${c.bold}${c.cyan}╭  Loopforge route matrix${c.reset}`);
  console.log(`${c.dim}│${c.reset}  BRouter     ${opts.baseUrl}`);
  console.log(
    `${c.dim}│${c.reset}  Matryca     ${opts.matrixLabel} · ${opts.catalogSize} w katalogu`,
  );
  console.log(
    `${c.dim}│${c.reset}  Scenariusze ${c.bold}${opts.scenarioCount}${c.reset}  ${c.dim}${opts.idPreview}${c.reset}`,
  );
  if (opts.saveGpxDir) {
    console.log(`${c.dim}│${c.reset}  GPX →       ${opts.saveGpxDir}`);
  }
  console.log(`${c.dim}╰${"─".repeat(70)}${c.reset}`);
  console.log("");
}

function printFinalReport(results: ScenarioRunResult[], durationMs: number): void {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const width =
    COL.status + COL.scenario + COL.km + COL.quality + COL.time + 8;

  console.log("");
  console.log(rule("═", width));
  console.log(
    `${c.bold} Raport końcowy${c.reset}   ${c.green}${passed} pass${c.reset} · ${failed > 0 ? c.red : c.dim}${failed} fail${c.reset} · ${results.length} · ${fmtSec(durationMs)}`,
  );
  console.log(rule("─", width));
  console.log(
    `${c.dim} ${pad("STATUS", COL.status)} ${pad("SCENARIO", COL.scenario)} ${pad("KM", COL.km)} ${pad("QUALITY", COL.quality)} ${pad("TIME", COL.time)}${c.reset}`,
  );
  console.log(rule("─", width));

  for (const r of results) {
    const status = r.ok
      ? `${c.green}PASS${c.reset}  `
      : `${c.red}FAIL${c.reset}  `;
    const name = scenarioDisplayName(r.scenario);
    const km =
      r.distanceKm != null ? r.distanceKm.toFixed(1) : "—";
    const quality = qualitySummary(r);
    const time = fmtSec(r.durationMs);
    console.log(
      ` ${status}${pad(name, COL.scenario)} ${pad(km, COL.km)} ${pad(quality, COL.quality)} ${pad(time, COL.time)}`,
    );
  }

  console.log(rule("═", width));

  if (failed === 0) {
    console.log(
      `${c.green}${c.bold} ✓  Wszystkie scenariusze OK${c.reset}  ${c.dim}${results.length} w ${fmtSec(durationMs)}${c.reset}`,
    );
  } else {
    console.log(
      `${c.red}${c.bold} ✗  ${failed} nieudanych${c.reset}  ${c.dim}${passed}/${results.length} OK · ${fmtSec(durationMs)}${c.reset}`,
    );
    console.log("");
    console.log(`${c.bold} Szczegóły błędów${c.reset}`);
    for (const r of results.filter((x) => !x.ok)) {
      console.log(
        ` ${c.red}•${c.reset} ${c.bold}${r.scenario.id}${c.reset}  ${c.dim}${scenarioDisplayName(r.scenario)}${c.reset}`,
      );
      const codes = shortError(r);
      console.log(`   ${c.red}${codes}${c.reset}`);
      if (r.error && r.error.includes("\n")) {
        const detailLines = r.error
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("[error]") || /^[A-Z_]+ /.test(l))
          .slice(0, 4);
        for (const line of detailLines) {
          console.log(`   ${c.dim}${line}${c.reset}`);
        }
      }
    }
  }
  console.log("");
}

type LiveCounters = { pass: number; fail: number };

function createProgressPrinter(
  scenarioLabel: string,
  index: number,
  total: number,
  counters: LiveCounters,
) {
  let lastLine = "";
  let lastWriteAt = 0;
  const started = Date.now();
  const shortName =
    scenarioLabel.length > 42 ? `${scenarioLabel.slice(0, 41)}…` : scenarioLabel;

  const clearLive = () => {
    if (IS_TTY) process.stdout.write("\r\u001b[2K");
  };

  const writeStatus = (text: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastWriteAt < 160 && text === lastLine) return;
    lastWriteAt = now;
    lastLine = text;
    const score = `${c.green}${counters.pass}${c.reset}/${c.red}${counters.fail}${c.reset}`;
    const prefix = `${c.cyan}${index}/${total}${c.reset} ${score}`;
    const elapsed = `${c.dim}${fmtSec(now - started)}${c.reset}`;
    if (IS_TTY) {
      const line = `${prefix}  ${text}  ${c.dim}${shortName}${c.reset}  ${elapsed}`;
      // Keep within typical terminal width.
      const max = Math.max(60, (process.stdout.columns ?? 100) - 1);
      process.stdout.write(
        `\r\u001b[2K${line.length > max ? `${line.slice(0, max - 1)}…` : line}`,
      );
    }
  };

  return {
    onProgress(progress: RouteGenerationProgress) {
      if (!IS_TTY) return;
      const variant =
        progress.variantIndex != null && progress.variantTotal != null
          ? ` ${progress.variantIndex}/${progress.variantTotal}`
          : "";
      const pct = Math.max(0, Math.min(100, progress.progress));
      writeStatus(
        `${c.magenta}${progressBar(pct)}${c.reset} ${pct.toFixed(0).padStart(3)}% ${phaseLabel(progress.phase)}${variant}`,
      );
    },
    onPhase(
      phase: "generate" | "audit-geometry" | "audit-gpx" | "audit-onpath",
    ) {
      if (!IS_TTY) return;
      const pct =
        phase === "generate"
          ? 0
          : phase === "audit-geometry"
            ? 90
            : phase === "audit-gpx"
              ? 94
              : 97;
      writeStatus(
        `${c.magenta}${progressBar(pct)}${c.reset} ${String(pct).padStart(3)}% ${phaseLabel(phase)}`,
        true,
      );
    },
    finish(result: ScenarioRunResult) {
      clearLive();
      if (result.ok) counters.pass += 1;
      else counters.fail += 1;

      const mark = result.ok
        ? `${c.green}✓${c.reset}`
        : `${c.red}✗${c.reset}`;
      const idx = `${c.dim}${String(index).padStart(String(total).length)}/${total}${c.reset}`;
      const name = pad(scenarioDisplayName(result.scenario), COL.scenario);
      const km =
        result.distanceKm != null
          ? `${result.distanceKm.toFixed(1)} km`
          : "—";
      const quality = qualitySummary(result);
      const time = fmtSec(result.durationMs);

      console.log(
        `${idx} ${mark} ${name}  ${c.dim}${pad(km, 8)} ${pad(quality, COL.quality)} ${time}${c.reset}`,
      );

      if (!result.ok) {
        console.log(`   ${c.red}${shortError(result)}${c.reset}`);
      }
    },
  };
}

async function main(): Promise<void> {
  // Keep the live report clean unless explicitly debugging the generator.
  if (process.env.LOOPFORGE_DEBUG !== "1") {
    process.env.NODE_ENV = "production";
  }

  if (!isBrouterConfigured()) {
    console.error(
      "BRouter not configured. Set BROUTER_URL (production) or install local segments.",
    );
    process.exit(2);
  }

  const config = getBrouterConfig()!;

  process.stdout.write(`${c.dim}Sprawdzam BRouter…${c.reset} `);
  const probeStarted = Date.now();
  await ensureBrouterServer(config);
  console.log(
    `${c.green}OK${c.reset} ${c.dim}(${fmtSec(Date.now() - probeStarted)})${c.reset}`,
  );

  const matrixEnv = (process.env.LOOPFORGE_MATRIX ?? "full").toLowerCase();
  const matrix: "full" | "core" = matrixEnv === "core" ? "core" : "full";
  const filter = process.env.LOOPFORGE_SCENARIOS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
    scenarios.length <= 10
      ? scenarios.map((s) => s.id).join(", ")
      : `${scenarios
          .slice(0, 6)
          .map((s) => s.id)
          .join(", ")} … +${scenarios.length - 6}`;

  printHeader({
    baseUrl: config.baseUrl,
    matrixLabel: filter?.length ? "filter → full" : matrix,
    catalogSize: catalog.length,
    scenarioCount: scenarios.length,
    idPreview,
    saveGpxDir: saveGpx ? outDir : undefined,
  });

  const results: ScenarioRunResult[] = [];
  const counters: LiveCounters = { pass: 0, fail: 0 };
  const matrixStarted = Date.now();

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]!;
    const printer = createProgressPrinter(
      scenario.label,
      i + 1,
      scenarios.length,
      counters,
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
      console.log(`   ${c.dim}↳ saved ${scenario.id}.gpx${c.reset}`);
    }
  }

  printFinalReport(results, Date.now() - matrixStarted);
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
