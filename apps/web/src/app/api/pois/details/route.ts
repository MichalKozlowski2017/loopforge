import { NextResponse } from "next/server";
import { googleMapsSearchUri, type PoiDetails } from "@/lib/pois";

/** Free enrichment only — Google Places ratings are intentionally not used (cost). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name")?.trim() ?? "";
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));

  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Brak parametrów" }, { status: 400 });
  }

  const details: PoiDetails = {
    googleMapsUri: googleMapsSearchUri(name, lat, lng),
    source: "maps-link",
  };

  return NextResponse.json(details);
}
