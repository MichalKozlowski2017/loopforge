export const POI_CATEGORIES = ["food", "fuel", "water", "toilets"] as const;

export type PoiCategory = (typeof POI_CATEGORIES)[number];

export const POI_CATEGORY_META: Record<
  PoiCategory,
  { label: string; color: string; /** OpenMapTiles `poi.class` values */ classes: string[] }
> = {
  food: {
    label: "Jedzenie",
    color: "#f97316",
    classes: ["restaurant", "cafe", "fast_food", "bar", "biergarten", "food_court"],
  },
  fuel: {
    label: "Stacje",
    color: "#3b82f6",
    classes: ["fuel", "charging_station"],
  },
  water: {
    label: "Woda",
    color: "#06b6d4",
    classes: ["drinking_water", "water_point", "fountain"],
  },
  toilets: {
    label: "Toalety",
    color: "#a78bfa",
    classes: ["toilets"],
  },
};

export const POI_MIN_ZOOM = 12;
