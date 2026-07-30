import { NextResponse } from "next/server";
import {
  POI_CATEGORIES,
  POI_CATEGORY_META,
  POI_MAX_RESULTS,
  categoryFromAmenity,
  type PoiCategory,
  type PoiFeature,
  type PoiFeatureCollection,
} from "@/lib/pois";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const USER_AGENT = "Loopforge/1.0 (https://loopforge.pl; contact@loopforge.pl)";

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function parseCategories(raw: string | null): PoiCategory[] {
  if (!raw) return [];
  const wanted = new Set(raw.split(",").map((s) => s.trim()));
  return POI_CATEGORIES.filter((c) => wanted.has(c));
}

function buildQuery(
  lat: number,
  lng: number,
  radiusM: number,
  categories: PoiCategory[],
): string {
  const filters = categories.flatMap((c) => POI_CATEGORY_META[c].overpassFilters);
  const around = `(around:${Math.round(radiusM)},${lat},${lng})`;
  const clauses = filters
    .map((f) => `node${f}${around};\n  way${f}${around};`)
    .join("\n  ");

  return `
[out:json][timeout:15];
(
  ${clauses}
);
out center ${POI_MAX_RESULTS};
`.trim();
}

function elementToFeature(el: OverpassElement): PoiFeature | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const amenity = el.tags?.amenity;
  if (!amenity) return null;
  const category = categoryFromAmenity(amenity);
  if (!category) return null;

  const name =
    el.tags?.name?.trim() ||
    el.tags?.brand?.trim() ||
    el.tags?.operator?.trim() ||
    amenity;

  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [lon!, lat!],
    },
    properties: {
      id: `${el.type}/${el.id}`,
      name,
      category,
      kind: amenity,
      cuisine: el.tags?.cuisine,
      openingHours: el.tags?.opening_hours,
      phone: el.tags?.phone ?? el.tags?.["contact:phone"],
      website: el.tags?.website ?? el.tags?.["contact:website"],
      brand: el.tags?.brand,
      operator: el.tags?.operator,
      wheelchair: el.tags?.wheelchair,
    },
  };
}

async function fetchOverpass(query: string): Promise<OverpassElement[]> {
  const body = `data=${encodeURIComponent(query)}`;
  const errors: unknown[] = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 16_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Accept: "application/json",
        },
        body,
        signal: controller.signal,
        next: { revalidate: 300 },
      });
      if (!response.ok) {
        errors.push(`${endpoint} HTTP ${response.status}`);
        continue;
      }
      const data = (await response.json()) as { elements?: OverpassElement[] };
      return data.elements ?? [];
    } catch (error) {
      errors.push(error);
    } finally {
      clearTimeout(timer);
    }
  }

  console.warn("[loopforge] Overpass failed:", errors);
  throw new Error("Overpass niedostępny");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const categories = parseCategories(searchParams.get("categories"));
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radiusM = Number(searchParams.get("radiusM") ?? "5000");

  if (
    categories.length === 0 ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(radiusM) ||
    radiusM < 200 ||
    radiusM > 25_000
  ) {
    return NextResponse.json({
      type: "FeatureCollection",
      features: [],
    } satisfies PoiFeatureCollection);
  }

  try {
    const elements = await fetchOverpass(
      buildQuery(lat, lng, radiusM, categories),
    );
    const seen = new Set<string>();
    const features: PoiFeature[] = [];

    for (const el of elements) {
      const feature = elementToFeature(el);
      if (!feature) continue;
      if (!categories.includes(feature.properties.category)) continue;
      if (seen.has(feature.properties.id)) continue;
      seen.add(feature.properties.id);
      features.push(feature);
      if (features.length >= POI_MAX_RESULTS) break;
    }

    return NextResponse.json({
      type: "FeatureCollection",
      features,
    } satisfies PoiFeatureCollection);
  } catch {
    return NextResponse.json(
      { error: "Nie udało się pobrać punktów" },
      { status: 502 },
    );
  }
}
