import { NextResponse } from "next/server";
import { generateRoute } from "@loopforge/generator";
import type { GenerateRouteRequest } from "@loopforge/osm-types";
import { saveRoute } from "@/lib/routes-store";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateRouteRequest;

    if (
      !body.start ||
      typeof body.start.lat !== "number" ||
      typeof body.start.lng !== "number" ||
      !body.bikeType ||
      !body.direction ||
      typeof body.distanceKm !== "number"
    ) {
      return NextResponse.json(
        { error: "Nieprawidłowe parametry żądania" },
        { status: 400 },
      );
    }

    const generated = await generateRoute(body);

    const stored = {
      ...generated,
      bikeType: body.bikeType,
      direction: body.direction,
      profile: body.profile,
      avoidAsphalt: body.avoidAsphalt,
      start: body.start,
    };

    await saveRoute(stored);

    return NextResponse.json(stored);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Błąd generowania trasy",
      },
      { status: 500 },
    );
  }
}
