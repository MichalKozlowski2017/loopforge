import type { BikeType, OsmTags } from "@loopforge/osm-types";

type WeightTable = Record<string, number>;

const GRAVEL_WEIGHTS: WeightTable = {
  "surface=gravel": 1.0,
  "surface=compacted": 0.9,
  "surface=unpaved": 0.7,
  "surface=dirt": 0.6,
  "highway=track": 0.85,
  "highway=cycleway": 0.95,
  "highway=residential": 0.5,
  "highway=primary": 0.1,
};

const ROAD_WEIGHTS: WeightTable = {
  "highway=primary": 1.0,
  "highway=secondary": 1.0,
  "highway=cycleway": 0.95,
  "highway=tertiary": 0.8,
  "surface=gravel": 0.2,
  "surface=unpaved": 0.2,
  "highway=track": 0.1,
};

const MTB_WEIGHTS: WeightTable = {
  "highway=path": 0.95,
  "highway=track": 0.9,
  "surface=ground": 0.85,
  "surface=dirt": 0.85,
  "highway=bridleway": 0.7,
  "highway=primary": 0.05,
};

const GENERAL_WEIGHTS: WeightTable = {
  "highway=cycleway": 0.95,
  "surface=gravel": 0.75,
  "highway=tertiary": 0.7,
  "highway=residential": 0.6,
  "highway=primary": 0.2,
  "highway=track": 0.5,
};

const PROFILES: Record<BikeType, WeightTable> = {
  gravel: GRAVEL_WEIGHTS,
  road: ROAD_WEIGHTS,
  mtb: MTB_WEIGHTS,
  general: GENERAL_WEIGHTS,
};

function tagKey(tags: OsmTags): string[] {
  const keys: string[] = [];
  if (tags.highway) keys.push(`highway=${tags.highway}`);
  if (tags.surface) keys.push(`surface=${tags.surface}`);
  return keys;
}

export function scoreSegment(tags: OsmTags, bikeType: BikeType): number {
  const weights = PROFILES[bikeType];
  const keys = tagKey(tags);
  let best = 0.3;

  for (const key of keys) {
    if (weights[key] !== undefined) {
      best = Math.max(best, weights[key]);
    }
  }

  return best;
}

export function scoreRoute(
  segments: { tags: OsmTags; distanceM: number }[],
  bikeType: BikeType,
): number {
  if (segments.length === 0) return 0;

  let weighted = 0;
  let total = 0;

  for (const segment of segments) {
    weighted += scoreSegment(segment.tags, bikeType) * segment.distanceM;
    total += segment.distanceM;
  }

  return total > 0 ? weighted / total : 0;
}

export function getWeights(bikeType: BikeType): WeightTable {
  return { ...PROFILES[bikeType] };
}
