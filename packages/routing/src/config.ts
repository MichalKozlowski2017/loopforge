import type { BikeType } from "@loopforge/osm-types";

export interface RoutingConfig {
  connectionString: string;
}

const COST_COLUMN: Record<BikeType, string> = {
  road: "cost_road",
  gravel: "cost_gravel",
  mtb: "cost_mtb",
  general: "cost_general",
};

export function getRoutingConfig(): RoutingConfig | null {
  const connectionString =
    process.env.DATABASE_URL?.trim() ||
    process.env.SUPABASE_DB_URL?.trim() ||
    "";

  if (!connectionString) return null;
  return { connectionString };
}

export function isRoutingConfigured(): boolean {
  return getRoutingConfig() !== null;
}

export function costColumnForBikeType(bikeType: BikeType): string {
  return COST_COLUMN[bikeType];
}
