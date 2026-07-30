"use client";

import { POI_CATEGORY_META, type PoiCategory, type PoiDetails } from "@/lib/pois";

export interface SelectedPoi {
  id: string;
  name: string;
  category: PoiCategory;
  kind: string;
  lat: number;
  lng: number;
}

interface PoiDetailCardProps {
  poi: SelectedPoi;
  details: PoiDetails | null;
  detailsLoading: boolean;
  onClose: () => void;
}

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    restaurant: "Restauracja",
    cafe: "Kawiarnia",
    fast_food: "Fast food",
    bar: "Bar",
    biergarten: "Ogródek",
    food_court: "Food court",
    fuel: "Stacja paliw",
    charging_station: "Ładowarka EV",
    drinking_water: "Woda pitna",
    water_point: "Punkt wody",
    fountain: "Fontanna",
    toilets: "Toaleta",
  };
  return map[kind] ?? kind;
}

export function PoiDetailCard({
  poi,
  details,
  detailsLoading,
  onClose,
}: PoiDetailCardProps) {
  const meta = POI_CATEGORY_META[poi.category];
  const rating = details?.rating;
  const ratingCount = details?.userRatingCount;
  const mapsUri = details?.googleMapsUri;
  const cuisine = details?.cuisine;
  const openingHours = details?.openingHours;
  const phone = details?.phone;
  const website = details?.website;

  return (
    <div className="absolute bottom-16 left-3 z-20 w-[min(100%-1.5rem,20rem)] rounded-xl border border-zinc-700/80 bg-zinc-950/95 p-3 shadow-xl backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-100">
            {poi.name}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            <span style={{ color: meta.color }}>{meta.label}</span>
            {" · "}
            {kindLabel(poi.kind)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Zamknij"
        >
          Zamknij
        </button>
      </div>

      <div className="mt-2 space-y-1.5 text-[12px] text-zinc-300">
        {detailsLoading ? (
          <p className="text-zinc-500">Szukam ocen…</p>
        ) : rating != null ? (
          <p>
            <span className="font-medium text-amber-300">
              ★ {rating.toFixed(1)}
            </span>
            {ratingCount != null ? (
              <span className="text-zinc-500"> ({ratingCount} opinii)</span>
            ) : null}
            {details?.source === "google" ? (
              <span className="text-zinc-600"> · Google</span>
            ) : null}
          </p>
        ) : (
          <p className="text-zinc-500">
            Brak oceny w aplikacji — zajrzyj do Google Maps.
          </p>
        )}

        {details?.address ? (
          <p className="text-zinc-400">{details.address}</p>
        ) : null}
        {cuisine ? (
          <p>
            <span className="text-zinc-500">Kuchnia: </span>
            {cuisine.replaceAll(";", ", ")}
          </p>
        ) : null}
        {openingHours ? (
          <p>
            <span className="text-zinc-500">Godziny: </span>
            {openingHours}
          </p>
        ) : null}
        {phone ? (
          <p>
            <span className="text-zinc-500">Tel: </span>
            <a href={`tel:${phone}`} className="text-sky-300 hover:underline">
              {phone}
            </a>
          </p>
        ) : null}
        {website ? (
          <p className="truncate">
            <a
              href={
                website.startsWith("http") ? website : `https://${website}`
              }
              target="_blank"
              rel="noreferrer"
              className="text-sky-300 hover:underline"
            >
              Strona WWW
            </a>
          </p>
        ) : null}
      </div>

      {mapsUri ? (
        <a
          href={mapsUri}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex w-full items-center justify-center rounded-lg bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-900 hover:bg-white"
        >
          Otwórz w Google Maps
        </a>
      ) : null}
    </div>
  );
}
