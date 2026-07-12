import { NextResponse } from "next/server";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Loopforge/1.0 (https://loopforge.pl; contact@loopforge.pl)";

export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
  place: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query || query.length < 2) {
    return NextResponse.json([]);
  }

  const url = new URL(NOMINATIM);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "6");
  url.searchParams.set("countrycodes", "pl");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("q", query);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Geokodowanie niedostępne" },
        { status: 502 },
      );
    }

    const data = (await response.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
      name?: string;
      address?: {
        city?: string;
        town?: string;
        village?: string;
        municipality?: string;
        county?: string;
      };
    }>;

    const results: GeocodeResult[] = data.map((item) => {
      const place =
        item.name ??
        item.address?.city ??
        item.address?.town ??
        item.address?.village ??
        item.address?.municipality ??
        item.display_name.split(",")[0]?.trim() ??
        item.display_name;

      return {
        lat: Number(item.lat),
        lng: Number(item.lon),
        label: item.display_name,
        place,
      };
    });

    return NextResponse.json(results);
  } catch {
    return NextResponse.json(
      { error: "Błąd geokodowania" },
      { status: 502 },
    );
  }
}
