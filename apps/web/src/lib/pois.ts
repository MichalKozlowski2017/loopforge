/** Feature flag — set true to show category toggles / POI layers on the map. */
export const POI_LAYERS_ENABLED = false;

export const POI_CATEGORIES = [
  "food",
  "fuel",
  "water",
  "toilets",
  "bike",
  "rest",
] as const;

export type PoiCategory = (typeof POI_CATEGORIES)[number];

export interface PoiDetails {
  address?: string;
  cuisine?: string;
  openingHours?: string;
  phone?: string;
  website?: string;
  googleMapsUri: string;
  source: "maps-link";
}

export const POI_CATEGORY_META: Record<
  PoiCategory,
  {
    label: string;
    color: string;
    /** OpenMapTiles `poi.class` / subclass values */
    classes: string[];
    /** Fallback sprite icon id when class has no matching image */
    fallbackIcon: string;
  }
> = {
  food: {
    label: "Jedzenie",
    color: "#f97316",
    classes: [
      "restaurant",
      "cafe",
      "fast_food",
      "bar",
      "biergarten",
      "food_court",
    ],
    fallbackIcon: "restaurant",
  },
  fuel: {
    label: "Stacje",
    color: "#3b82f6",
    classes: ["fuel", "charging_station"],
    fallbackIcon: "fuel",
  },
  water: {
    label: "Woda",
    color: "#06b6d4",
    classes: ["drinking_water", "water_point", "fountain"],
    fallbackIcon: "drinking_water",
  },
  toilets: {
    label: "Toalety",
    color: "#a78bfa",
    classes: ["toilets"],
    fallbackIcon: "toilets",
  },
  bike: {
    label: "Rower",
    color: "#22c55e",
    classes: ["bicycle", "bicycle_rental", "bicycle_repair_station"],
    fallbackIcon: "bicycle",
  },
  rest: {
    label: "Odpoczynek",
    color: "#eab308",
    classes: ["picnic_site", "shelter", "viewpoint"],
    fallbackIcon: "picnic_site",
  },
};

/** Show POIs from city / metro overview. */
export const POI_MIN_ZOOM = 7;

export function categoryForPoiClass(poiClass: string): PoiCategory | null {
  for (const category of POI_CATEGORIES) {
    if (POI_CATEGORY_META[category].classes.includes(poiClass)) {
      return category;
    }
  }
  return null;
}

export function googleMapsSearchUri(
  name: string,
  lat: number,
  lng: number,
): string {
  const query = `${name} @${lat.toFixed(5)},${lng.toFixed(5)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
