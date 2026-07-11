import { Pool, type PoolClient } from "pg";
import type { RoutingConfig } from "./config";

let pool: Pool | null = null;

export function getPool(config: RoutingConfig): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: config.connectionString.includes("supabase.co")
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }
  return pool;
}

export async function withClient<T>(
  config: RoutingConfig,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool(config).connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
