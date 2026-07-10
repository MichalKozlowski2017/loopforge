import { spawn, type ChildProcess } from "node:child_process";
import type { BrouterConfig } from "./config.js";

let serverProcess: ChildProcess | null = null;
let starting: Promise<void> | null = null;

async function isServerHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${baseUrl}/brouter?lonlats=0,0|0,0&profile=trekking&engineMode=3`,
      { signal: AbortSignal.timeout(1500) },
    );
    return response.status < 500;
  } catch {
    return false;
  }
}

function startServerProcess(config: BrouterConfig): Promise<void> {
  if (starting) return starting;

  starting = new Promise((resolve, reject) => {
    const args = [
      "-Xmx256M",
      "-DmaxRunningTime=300",
      "-cp",
      config.jarPath,
      "btools.server.RouteServer",
      config.segmentsDir,
      config.profilesDir,
      config.customProfilesDir,
      String(config.port),
      "4",
    ];

    serverProcess = spawn("java", args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    serverProcess.on("error", reject);
    serverProcess.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.includes("Exception") || text.includes("Error")) {
        console.error("[brouter]", text.trim());
      }
    });

    const deadline = Date.now() + 15_000;
    const poll = async () => {
      if (await isServerHealthy(config.baseUrl)) {
        resolve();
        starting = null;
        return;
      }
      if (Date.now() > deadline) {
        starting = null;
        reject(new Error("BRouter server failed to start within 15s"));
        return;
      }
      setTimeout(poll, 300);
    };

    void poll();
  });

  return starting;
}

export async function ensureBrouterServer(config: BrouterConfig): Promise<void> {
  if (await isServerHealthy(config.baseUrl)) return;
  await startServerProcess(config);
}

export function stopBrouterServer(): void {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
}
