import { NextResponse } from "next/server";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Loopforge/1.0 (https://loopforge.pl; contact@loopforge.pl)";

export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
  place: string;
}

type NominatimItem = {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type?: string;
  class?: string;
  importance?: number;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    hamlet?: string;
    county?: string;
    state?: string;
    country?: string;
    country_code?: string;
  };
};

function placeName(item: NominatimItem): string {
  return (
    item.name ??
    item.address?.city ??
    item.address?.town ??
    item.address?.village ??
    item.address?.municipality ??
    item.address?.hamlet ??
    item.display_name.split(",")[0]?.trim() ??
    item.display_name
  );
}

function placeHint(item: NominatimItem): string {
  const parts = [
    item.address?.county,
    item.address?.state,
    item.address?.country,
  ].filter(Boolean);
  if (parts.length === 0) return item.display_name;
  return parts.join(", ");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query || query.length < 2) {
    return NextResponse.json([]);
  }

  const url = new URL(NOMINATIM);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "8");
  url.searchParams.set("addressdetails", "1");
  // Prefer named settlements over POIs when possible.
  url.searchParams.set("featureType", "settlement");
  url.searchParams.set("q", query);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "pl,en,it,de,fr,es",
      },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Geokodowanie niedostępne" },
        { status: 502 },
      );
    }

    let data = (await response.json()) as NominatimItem[];

    // Fallback: unrestricted search if settlement filter returned nothing
    // (e.g. obscure hamlets / typos Nominatim still resolves without featureType).
    if (data.length === 0) {
      const fallback = new URL(NOMINATIM);
      fallback.searchParams.set("format", "json");
      fallback.searchParams.set("limit", "8");
      fallback.searchParams.set("addressdetails", "1");
      fallback.searchParams.set("q", query);
      const retry = await fetch(fallback.toString(), {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          "Accept-Language": "pl,en,it,de,fr,es",
        },
        next: { revalidate: 3600 },
      });
      if (retry.ok) {
        data = (await retry.json()) as NominatimItem[];
      }
    }

    const seen = new Set<string>();
    const results: GeocodeResult[] = [];
    for (const item of data) {
      const lat = Number(item.lat);
      const lng = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        lat,
        lng,
        label: placeHint(item),
        place: placeName(item),
      });
    }

    return NextResponse.json(results);
  } catch {
    return NextResponse.json(
      { error: "Błąd geokodowania" },
      { status: 502 },
    );
  }
}
