import { existsSync } from "node:fs";
import path from "node:path";

export interface BrouterConfig {
  jarPath: string;
  segmentsDir: string;
  profilesDir: string;
  customProfilesDir: string;
  port: number;
  baseUrl: string;
}

function findMonorepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.resolve(start);
}

function resolvePath(value: string | undefined, fallback: string): string {
  const monorepoRoot = findMonorepoRoot();
  const raw = value?.trim() || fallback;
  if (path.isAbsolute(raw)) return raw;

  const fromCwd = path.resolve(process.cwd(), raw);
  if (existsSync(fromCwd)) return fromCwd;

  return path.resolve(monorepoRoot, raw);
}

export function getBrouterConfig(): BrouterConfig | null {
  const port = Number(process.env.BROUTER_PORT ?? "17777");
  const baseUrl = process.env.BROUTER_URL?.trim() || `http://127.0.0.1:${port}`;
  const isRemote =
    !!process.env.BROUTER_URL?.trim() &&
    !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(baseUrl);

  if (isRemote) {
    return {
      jarPath: "",
      segmentsDir: "",
      profilesDir: "",
      customProfilesDir: "",
      port,
      baseUrl: baseUrl.replace(/\/$/, ""),
    };
  }

  const jarPath = resolvePath(
    process.env.BROUTER_JAR,
    "infra/brouter/brouter-1.7.9/brouter-1.7.9-all.jar",
  );
  const segmentsDir = resolvePath(
    process.env.BROUTER_SEGMENTS_DIR,
    "infra/brouter/segments4",
  );
  const profilesDir = resolvePath(
    process.env.BROUTER_PROFILES_DIR,
    "infra/brouter/brouter-1.7.9/profiles2",
  );
  const customProfilesDir = resolvePath(
    process.env.BROUTER_CUSTOM_PROFILES_DIR,
    "infra/brouter/customprofiles",
  );

  if (!existsSync(jarPath) || !existsSync(segmentsDir) || !existsSync(profilesDir)) {
    return null;
  }

  return {
    jarPath,
    segmentsDir,
    profilesDir,
    customProfilesDir,
    port,
    baseUrl,
  };
}

export function isBrouterConfigured(): boolean {
  return getBrouterConfig() !== null;
}
