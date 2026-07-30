export const POI_CATEGORIES = ["food", "fuel", "water", "toilets"] as const;

export type PoiCategory = (typeof POI_CATEGORIES)[number];

export interface PoiTags {
  cuisine?: string;
  openingHours?: string;
  phone?: string;
  website?: string;
  brand?: string;
  operator?: string;
  wheelchair?: string;
}

export interface PoiFeatureProperties {
  id: string;
  name: string;
  category: PoiCategory;
  kind: string;
  cuisine?: string;
  openingHours?: string;
  phone?: string;
  website?: string;
  brand?: string;
  operator?: string;
  wheelchair?: string;
}

export interface PoiFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: PoiFeatureProperties;
}

export interface PoiFeatureCollection {
  type: "FeatureCollection";
  features: PoiFeature[];
}

export interface PoiDetails {
  rating?: number;
  userRatingCount?: number;
  address?: string;
  googleMapsUri: string;
  source: "google" | "maps-link";
}

export const POI_CATEGORY_META: Record<
  PoiCategory,
  { label: string; color: string; overpassFilters: string[] }
> = {
  food: {
    label: "Jedzenie",
    color: "#f97316",
    overpassFilters: [
      '["amenity"="restaurant"]',
      '["amenity"="cafe"]',
      '["amenity"="fast_food"]',
      '["amenity"="bar"]',
      '["amenity"="biergarten"]',
      '["amenity"="food_court"]',
    ],
  },
  fuel: {
    label: "Stacje",
    color: "#3b82f6",
    overpassFilters: [
      '["amenity"="fuel"]',
      '["amenity"="charging_station"]',
    ],
  },
  water: {
    label: "Woda",
    color: "#06b6d4",
    overpassFilters: [
      '["amenity"="drinking_water"]',
      '["amenity"="water_point"]',
      '["amenity"="fountain"]',
    ],
  },
  toilets: {
    label: "Toalety",
    color: "#a78bfa",
    overpassFilters: ['["amenity"="toilets"]'],
  },
};

/** Show POIs from city / metro overview. */
export const POI_MIN_ZOOM = 7;
export const POI_MAX_RESULTS = 120;

export function categoryFromAmenity(amenity: string): PoiCategory | null {
  for (const category of POI_CATEGORIES) {
    if (
      POI_CATEGORY_META[category].overpassFilters.some((f) =>
        f.includes(`"${amenity}"`),
      )
    ) {
      return category;
    }
  }
  return null;
}

/** Search radius (m) around map center — keeps Overpass queries bounded when zoomed out. */
export function poiSearchRadiusM(zoom: number): number {
  if (zoom < 8) return 18_000;
  if (zoom < 9) return 12_000;
  if (zoom < 10) return 8_000;
  if (zoom < 11) return 5_500;
  if (zoom < 12) return 3_500;
  if (zoom < 14) return 2_500;
  return 1_800;
}

export function googleMapsSearchUri(
  name: string,
  lat: number,
  lng: number,
): string {
  const query = `${name} @${lat.toFixed(5)},${lng.toFixed(5)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
