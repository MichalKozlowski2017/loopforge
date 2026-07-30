import type { RouteRating } from "@loopforge/osm-types";

export const ROUTE_FEEDBACK_TAGS = [
  { id: "too_much_asphalt", label: "Za dużo asfaltu" },
  { id: "too_much_dirt", label: "Za dużo szuteru / ziemi" },
  { id: "busy_roads", label: "Ruchliwe / niebezpieczne drogi" },
  { id: "wrong_vibe", label: "Nie pasuje do trybu roweru" },
  { id: "bad_direction", label: "Zły kierunek / region" },
  { id: "distance_off", label: "Dystans mocno poza celem" },
  { id: "boring_overlap", label: "Nudna / za dużo overlapu" },
  { id: "nav_issues", label: "Problem z nawigacją GPX" },
] as const;

export type RouteFeedbackTagId = (typeof ROUTE_FEEDBACK_TAGS)[number]["id"];

const TAG_IDS = new Set<string>(ROUTE_FEEDBACK_TAGS.map((t) => t.id));

export function isRouteRating(value: unknown): value is RouteRating {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
  );
}

export function sanitizeFeedbackTags(tags: unknown): RouteFeedbackTagId[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<RouteFeedbackTagId>();
  for (const tag of tags) {
    if (typeof tag === "string" && TAG_IDS.has(tag)) {
      seen.add(tag as RouteFeedbackTagId);
    }
  }
  return [...seen];
}

export function feedbackTagLabel(id: string): string {
  return ROUTE_FEEDBACK_TAGS.find((t) => t.id === id)?.label ?? id;
}
