#!/usr/bin/env node
/**
 * Enable RLS + revoke anon/authenticated on osm2pgsql tables.
 * Uses direct Postgres connection (import holds locks — Supabase API times out).
 */
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pg = require("../../packages/routing/node_modules/pg");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const TABLES = [
  "planet_osm_point",
  "planet_osm_line",
  "planet_osm_polygon",
  "planet_osm_roads",
  "planet_osm_nodes",
  "planet_osm_ways",
  "planet_osm_rels",
  "osm2pgsql_properties",
];

function resolveDbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = join(ROOT, "apps/web/.env.local");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^DATABASE_URL=(.*)$/m);
    if (m?.[1]?.trim() && !m[1].includes("[")) return m[1].trim();
  }
  throw new Error("Brak DATABASE_URL (ustaw env lub apps/web/.env.local)");
}

async function applyTable(client, tbl) {
  const reg = await client.query("SELECT to_regclass($1) AS reg", [`public.${tbl}`]);
  if (!reg.rows[0]?.reg) return "missing";

  await client.query(`REVOKE ALL ON TABLE public.${tbl} FROM anon, authenticated`);
  await client.query(`ALTER TABLE public.${tbl} ENABLE ROW LEVEL SECURITY`);
  await client.query(`DROP POLICY IF EXISTS osm_service_role_all ON public.${tbl}`);
  await client.query(
    `CREATE POLICY osm_service_role_all ON public.${tbl} FOR ALL TO service_role USING (true) WITH CHECK (true)`,
  );
  return "ok";
}

async function main() {
  const retries = Number(process.env.OSM_RLS_RETRIES ?? 12);
  const delayMs = Number(process.env.OSM_RLS_RETRY_DELAY_MS ?? 10_000);
  const lockTimeoutMs = Number(process.env.OSM_RLS_LOCK_TIMEOUT_MS ?? 30_000);

  const client = new pg.Client({
    connectionString: resolveDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const pending = new Set(TABLES);
  for (let attempt = 1; attempt <= retries && pending.size > 0; attempt++) {
    await client.query(`SET lock_timeout = '${lockTimeoutMs}ms'`);
    for (const tbl of [...pending]) {
      try {
        const status = await applyTable(client, tbl);
        if (status === "missing") {
          pending.delete(tbl);
          console.log(`skip (brak tabeli): ${tbl}`);
        } else {
          pending.delete(tbl);
          console.log(`ok: ${tbl}`);
        }
      } catch (err) {
        console.log(`retry ${attempt}/${retries}: ${tbl} — ${err.message.split("\n")[0]}`);
      }
    }
    if (pending.size > 0 && attempt < retries) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  await client.end();

  if (pending.size > 0) {
    console.error("Nie udało się zabezpieczyć:", [...pending].join(", "));
    process.exit(1);
  }
  console.log("✓ RLS na tabelach OSM włączone");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
