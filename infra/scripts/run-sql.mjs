#!/usr/bin/env node
/**
 * Run a SQL file via direct Postgres connection (avoids Supabase API 524 timeouts).
 */
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pg = require("../../packages/routing/node_modules/pg");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function resolveDbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = join(ROOT, "apps/web/.env.local");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^DATABASE_URL=(.*)$/m);
    if (m?.[1]?.trim() && !m[1].includes("[")) return m[1].trim();
  }
  throw new Error("Brak DATABASE_URL");
}

async function main() {
  const sqlPath = resolve(process.argv[2] ?? "");
  if (!sqlPath || !existsSync(sqlPath)) {
    console.error("Usage: node run-sql.mjs <path/to/file.sql>");
    process.exit(1);
  }

  const sql = readFileSync(sqlPath, "utf8");
  const client = new pg.Client({
    connectionString: resolveDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("SET statement_timeout = 0");
  await client.query("SET lock_timeout = 0");
  console.log(`→ ${sqlPath}`);
  await client.query(sql);
  await client.end();
  console.log("✓ SQL zakończone");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
