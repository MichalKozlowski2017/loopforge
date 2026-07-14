import type { BikeType, RideProfile } from "@loopforge/osm-types";

type WeightTable = Record<string, number>;

const GRAVEL_FLOW: WeightTable = {
  "surface=gravel": 1.0,
  "surface=compacted": 0.9,
  "surface=unpaved": 0.7,
  "surface=dirt": 0.6,
  "highway=track": 0.85,
  "highway=cycleway": 0.95,
  "highway=residential": 0.5,
  "highway=primary": 0.1,
};

const GRAVEL_TECHNICAL: WeightTable = {
  ...GRAVEL_FLOW,
  "surface=gravel": 1.0,
  "surface=dirt": 0.92,
  "surface=ground": 0.88,
  "highway=path": 0.9,
  "highway=track": 0.95,
  "highway=residential": 0.25,
  "highway=primary": 0.02,
};

const GRAVEL_FAST: WeightTable = {
  ...GRAVEL_FLOW,
  "surface=gravel": 0.75,
  "surface=compacted": 0.88,
  "highway=cycleway": 1.0,
  "highway=tertiary": 0.82,
  "highway=residential": 0.72,
  "highway=primary": 0.35,
};

const ROAD_FAST: WeightTable = {
  "highway=primary": 1.0,
  "highway=secondary": 1.0,
  "highway=cycleway": 0.95,
  "highway=tertiary": 0.88,
  "surface=gravel": 0.12,
  "surface=unpaved": 0.08,
  "highway=track": 0.05,
};

const ROAD_FLOW: WeightTable = {
  ...ROAD_FAST,
  "highway=primary": 0.82,
  "highway=secondary": 0.92,
  "highway=tertiary": 0.95,
  "highway=residential": 0.88,
};

const ROAD_TECHNICAL: WeightTable = {
  ...ROAD_FLOW,
  "highway=primary": 0.35,
  "highway=secondary": 0.55,
  "highway=tertiary": 0.95,
  "highway=residential": 0.98,
  "highway=track": 0.45,
  "surface=gravel": 0.35,
};

const MTB_FLOW: WeightTable = {
  "highway=path": 0.92,
  "highway=track": 0.9,
  "surface=ground": 0.85,
  "surface=dirt": 0.85,
  "highway=bridleway": 0.75,
  "highway=primary": 0.05,
};

const MTB_TECHNICAL: WeightTable = {
  ...MTB_FLOW,
  "highway=path": 1.0,
  "surface=dirt": 0.95,
  "surface=ground": 0.95,
  "highway=track": 0.82,
  "highway=primary": 0.01,
};

const MTB_FAST: WeightTable = {
  ...MTB_FLOW,
  "highway=track": 0.98,
  "highway=path": 0.72,
  "highway=tertiary": 0.55,
  "highway=residential": 0.45,
  "highway=primary": 0.12,
};

const GENERAL_FLOW: WeightTable = {
  "highway=cycleway": 0.95,
  "surface=gravel": 0.75,
  "highway=tertiary": 0.7,
  "highway=residential": 0.6,
  "highway=primary": 0.2,
  "highway=track": 0.5,
};

const GENERAL_TECHNICAL: WeightTable = {
  ...GENERAL_FLOW,
  "surface=gravel": 0.92,
  "surface=dirt": 0.85,
  "highway=track": 0.88,
  "highway=path": 0.82,
  "highway=primary": 0.05,
};

const GENERAL_FAST: WeightTable = {
  ...GENERAL_FLOW,
  "highway=tertiary": 0.88,
  "highway=residential": 0.82,
  "surface=gravel": 0.45,
  "highway=primary": 0.45,
};

const PROFILE_WEIGHTS: Record<
  BikeType,
  Partial<Record<RideProfile, WeightTable>>
> = {
  gravel: {
    flow: GRAVEL_FLOW,
    technical: GRAVEL_TECHNICAL,
    fast: GRAVEL_FAST,
  },
  road: {
    flow: ROAD_FLOW,
    technical: ROAD_TECHNICAL,
    fast: ROAD_FAST,
  },
  mtb: {
    flow: MTB_FLOW,
    technical: MTB_TECHNICAL,
    fast: MTB_FAST,
  },
  general: {
    flow: GENERAL_FLOW,
    technical: GENERAL_TECHNICAL,
    fast: GENERAL_FAST,
  },
};

export function getScoringWeights(
  bikeType: BikeType,
  profile?: RideProfile,
): WeightTable | null {
  if (!profile) return null;
  return PROFILE_WEIGHTS[bikeType][profile] ?? null;
}
