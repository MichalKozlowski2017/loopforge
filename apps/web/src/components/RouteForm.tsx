"use client";

import type { BikeType, Direction } from "@loopforge/osm-types";

export interface RouteFormValues {
  bikeType: BikeType;
  distanceKm: number;
  direction: Direction;
  lat: number;
  lng: number;
}

interface RouteFormProps {
  values: RouteFormValues;
  loading: boolean;
  onChange: (values: RouteFormValues) => void;
  onSubmit: () => void;
}

const BIKE_TYPES: { value: BikeType; label: string }[] = [
  { value: "gravel", label: "Gravel" },
  { value: "road", label: "Szosa" },
  { value: "mtb", label: "MTB" },
  { value: "general", label: "Ogólny" },
];

const DIRECTIONS: Direction[] = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
];

export function RouteForm({
  values,
  loading,
  onChange,
  onSubmit,
}: RouteFormProps) {
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-300">
          Tryb jazdy
        </label>
        <div className="grid grid-cols-2 gap-2">
          {BIKE_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => onChange({ ...values, bikeType: type.value })}
              className={`rounded-lg border px-3 py-2 text-sm transition ${
                values.bikeType === type.value
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label
          htmlFor="distance"
          className="mb-2 block text-sm font-medium text-zinc-300"
        >
          Dystans (km)
        </label>
        <input
          id="distance"
          type="number"
          min={10}
          max={200}
          step={5}
          value={values.distanceKm}
          onChange={(event) =>
            onChange({ ...values, distanceKm: Number(event.target.value) })
          }
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-300">
          Kierunek
        </label>
        <div className="grid grid-cols-4 gap-2">
          {DIRECTIONS.map((direction) => (
            <button
              key={direction}
              type="button"
              onClick={() => onChange({ ...values, direction })}
              className={`rounded-lg border px-2 py-2 text-sm transition ${
                values.direction === direction
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
              }`}
            >
              {direction}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="lat"
            className="mb-2 block text-sm font-medium text-zinc-300"
          >
            Szer. geogr.
          </label>
          <input
            id="lat"
            type="number"
            step="0.0001"
            value={values.lat}
            onChange={(event) =>
              onChange({ ...values, lat: Number(event.target.value) })
            }
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="lng"
            className="mb-2 block text-sm font-medium text-zinc-300"
          >
            Dł. geogr.
          </label>
          <input
            id="lng"
            type="number"
            step="0.0001"
            value={values.lng}
            onChange={(event) =>
              onChange({ ...values, lng: Number(event.target.value) })
            }
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Generuję…" : "Generuj pętlę"}
      </button>
    </form>
  );
}
