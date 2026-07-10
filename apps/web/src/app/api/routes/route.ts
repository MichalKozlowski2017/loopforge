import { NextResponse } from "next/server";
import { loadRoutes } from "@/lib/routes-store";

export async function GET() {
  const routes = await loadRoutes();
  const summaries = routes.map((route) => ({
    id: route.id,
    bikeType: route.bikeType,
    direction: route.direction,
    profile: route.profile,
    distanceKm: route.metrics.distanceKm,
    score: route.metrics.score,
    elevationGainM: route.metrics.elevationGainM,
    rating: route.rating,
    notes: route.notes,
    createdAt: route.createdAt,
    placeholder: route.geojson.properties.placeholder === true,
  }));

  return NextResponse.json(summaries);
}
