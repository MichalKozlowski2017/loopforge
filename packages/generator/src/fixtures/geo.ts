/** Synthetic [lng, lat] tracks for route-quality unit tests (Warsaw-ish). */

const ORIGIN: [number, number] = [21.0, 52.25];

/** ~meter offsets → degrees at this latitude. */
function offsetMeters(lng: number, lat: number, eastM: number, northM: number): [number, number] {
  const dLat = northM / 111_320;
  const dLng = eastM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lng + dLng, lat + dLat];
}

/** Closed rectangle loop (~perimeter meters). */
export function rectLoop(
  westM: number,
  southM: number,
  widthM: number,
  heightM: number,
  stepM = 40,
): [number, number][] {
  const [lng0, lat0] = ORIGIN;
  const corners: [number, number][] = [
    offsetMeters(lng0, lat0, westM, southM),
    offsetMeters(lng0, lat0, westM + widthM, southM),
    offsetMeters(lng0, lat0, westM + widthM, southM + heightM),
    offsetMeters(lng0, lat0, westM, southM + heightM),
    offsetMeters(lng0, lat0, westM, southM),
  ];

  const coords: [number, number][] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i]!;
    const b = corners[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dist = Math.hypot(dx * 111_320 * Math.cos((a[1] * Math.PI) / 180), dy * 111_320);
    const steps = Math.max(1, Math.ceil(dist / stepM));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      coords.push([a[0] + dx * t, a[1] + dy * t]);
    }
  }
  coords.push(corners[corners.length - 1]!);
  return coords;
}

/** Insert a long air-chord jump mid-route. */
export function withTeleport(
  coordinates: [number, number][],
  atIndex: number,
  jumpEastM: number,
  jumpNorthM: number,
): [number, number][] {
  const out = coordinates.map((c) => [...c] as [number, number]);
  const pivot = out[atIndex]!;
  out[atIndex + 1] = offsetMeters(pivot[0], pivot[1], jumpEastM, jumpNorthM);
  return out;
}

/**
 * Out-and-back spur: go along a side street and reverse back to the junction.
 */
export function withDeadEndSpur(
  coordinates: [number, number][],
  atIndex: number,
  spurLengthM: number,
  stepM = 25,
): [number, number][] {
  const junction = coordinates[atIndex]!;
  const outbound: [number, number][] = [];
  const steps = Math.max(2, Math.ceil(spurLengthM / stepM));
  for (let s = 1; s <= steps; s++) {
    outbound.push(offsetMeters(junction[0], junction[1], spurLengthM * (s / steps), 0));
  }
  const inbound = [...outbound].reverse().slice(1);
  return [
    ...coordinates.slice(0, atIndex + 1),
    ...outbound,
    ...inbound,
    ...coordinates.slice(atIndex + 1),
  ];
}

/** Prefix mirrored at the end (dojazd + powrót). */
export function withMirroredApproach(
  loop: [number, number][],
  approachPoints: [number, number][],
): [number, number][] {
  const returnLeg = [...approachPoints].reverse();
  return [...approachPoints, ...loop, ...returnLeg];
}

export function approachCorridor(lengthM: number, stepM = 30): [number, number][] {
  const [lng0, lat0] = ORIGIN;
  const pts: [number, number][] = [];
  const steps = Math.max(2, Math.ceil(lengthM / stepM));
  for (let s = 0; s <= steps; s++) {
    pts.push(offsetMeters(lng0, lat0, 0, lengthM * (s / steps)));
  }
  return pts;
}
