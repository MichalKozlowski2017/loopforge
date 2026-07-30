"use client";

import type {
  BikeType,
  Direction,
  PlanningMode,
  RideProfile,
  RouteViaPoint,
} from "@loopforge/osm-types";
import { getRideProfileOptions } from "@loopforge/osm-types";
import { MAX_WAYPOINT_MODE_POINTS } from "@loopforge/generator/via-validation";
import { DirectionCompass } from "@/components/DirectionCompass";
import { LocationSearch } from "@/components/LocationSearch";
import { ViaPointsEditor } from "@/components/ViaPointsEditor";

export interface RouteFormValues {
  planningMode: PlanningMode;
  bikeType: BikeType;
  distanceKm: number;
  direction: Direction;
  profile: RideProfile;
  avoidAsphalt: boolean;
  preferQuietRoutes: boolean;
  approachEnabled: boolean;
  approachDistanceKm: number;
  lat: number;
  lng: number;
  viaPoints: RouteViaPoint[];
}

interface RouteFormProps {
  values: RouteFormValues;
  loading: boolean;
  pickOnMap: boolean;
  pickViaOnMap: boolean;
  locationStatus: "loading" | "ready" | "denied" | "unavailable" | "manual";
  onChange: (values: RouteFormValues) => void;
  onSubmit: () => void;
  onUseMyLocation: () => void;
  onTogglePickOnMap: () => void;
  onTogglePickViaOnMap: () => void;
}

const BIKE_TYPES: { value: BikeType; label: string }[] = [
  { value: "gravel", label: "Gravel" },
  { value: "road", label: "Szosa" },
  { value: "mtb", label: "MTB" },
  { value: "general", label: "Ogólny" },
];

const DISTANCE_PRESETS = [20, 35, 50, 80, 120];
const APPROACH_DISTANCE_PRESETS = [5, 8, 12, 15, 20];

export function RouteForm({
  values,
  loading,
  pickOnMap,
  pickViaOnMap,
  locationStatus,
  onChange,
  onSubmit,
  onUseMyLocation,
  onTogglePickOnMap,
  onTogglePickViaOnMap,
}: RouteFormProps) {
  const profiles = getRideProfileOptions(values.bikeType);
  const selectedProfile = profiles.find((profile) => profile.value === values.profile);
  const waypointsMode = values.planningMode === "waypoints";
  const viaCount = values.viaPoints.filter(
    (p) =>
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng) &&
      !(Math.abs(p.lat) < 0.0001 && Math.abs(p.lng) < 0.0001),
  ).length;

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
          Tryb generowania
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "loop" as const, label: "Pętla", hint: "km + kierunek" },
              {
                value: "waypoints" as const,
                label: "Przez punkty",
                hint: "zalicz pinezki",
              },
            ] as const
          ).map((mode) => (
            <button
              key={mode.value}
              type="button"
              title={mode.hint}
              onClick={() =>
                onChange({
                  ...values,
                  planningMode: mode.value,
                  approachEnabled:
                    mode.value === "waypoints" ? false : values.approachEnabled,
                  viaPoints: mode.value !== values.planningMode ? [] : values.viaPoints,
                })
              }
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                values.planningMode === mode.value
                  ? "border-amber-500 bg-amber-500/10 text-amber-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-700/40"
              }`}
            >
              <span className="block font-medium">{mode.label}</span>
              <span className="mt-0.5 block text-[11px] text-zinc-500">
                {mode.hint}
              </span>
            </button>
          ))}
        </div>
      </div>

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
                  ? "border-amber-500 bg-amber-500/10 text-amber-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-700/40"
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-300">
          Podprofil
        </label>
        <div className="grid grid-cols-3 gap-2">
          {profiles.map((profile) => (
            <button
              key={profile.value}
              type="button"
              title={profile.hint}
              onClick={() => onChange({ ...values, profile: profile.value })}
              className={`rounded-lg border px-2 py-2 text-sm transition ${
                values.profile === profile.value
                  ? "border-amber-500 bg-amber-500/10 text-amber-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-700/40"
              }`}
            >
              {profile.label}
            </button>
          ))}
        </div>
        {selectedProfile ? (
          <p className="mt-2 text-xs text-zinc-500">{selectedProfile.hint}</p>
        ) : null}
      </div>

      {values.bikeType === "gravel" || values.bikeType === "mtb" ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 transition hover:border-amber-800/45">
          <input
            type="checkbox"
            checked={values.avoidAsphalt}
            onChange={(event) =>
              onChange({ ...values, avoidAsphalt: event.target.checked })
            }
            className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-amber-600 focus:ring-amber-500"
          />
          <span>
            <span className="block text-sm font-medium text-zinc-200">
              Unikaj asfaltu i chodników
            </span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              Priorytet szutru, leśnych dróg i ścieżek. Omijamy asfalt i
              chodniki, gdy jest sensowna alternatywa.
            </span>
          </span>
        </label>
      ) : null}

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 transition hover:border-amber-800/45">
        <input
          type="checkbox"
          checked={values.preferQuietRoutes}
          onChange={(event) =>
            onChange({ ...values, preferQuietRoutes: event.target.checked })
          }
          className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-amber-600 focus:ring-amber-500"
        />
        <span>
          <span className="block text-sm font-medium text-zinc-200">
            Ścieżki i spokojne drogi
          </span>
          <span className="mt-0.5 block text-xs text-zinc-500">
            Priorytet ścieżek rowerowych i spokojnych ulic. Omijamy ruch
            samochodowy, gdy jest sensowna alternatywa.
          </span>
        </span>
      </label>

      {!waypointsMode ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 transition hover:border-amber-800/45">
          <input
            type="checkbox"
            checked={values.approachEnabled}
            onChange={(event) =>
              onChange({ ...values, approachEnabled: event.target.checked })
            }
            className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-amber-600 focus:ring-amber-500"
          />
          <span>
            <span className="block text-sm font-medium text-zinc-200">
              Dojazd do pętli
            </span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              Najszybsza trasa z domu do startu pętli. Dystans poniżej dotyczy
              samej pętli — dojazd i powrót liczą się osobno.
            </span>
          </span>
        </label>
      ) : null}

      {!waypointsMode && values.approachEnabled ? (
        <div>
          <label
            htmlFor="approachDistance"
            className="mb-2 block text-sm font-medium text-zinc-300"
          >
            Odległość dojazdu (km)
          </label>
          <input
            id="approachDistance"
            type="number"
            min={1}
            max={40}
            step={1}
            value={values.approachDistanceKm}
            onChange={(event) =>
              onChange({
                ...values,
                approachDistanceKm: Number(event.target.value),
              })
            }
            className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            {APPROACH_DISTANCE_PRESETS.map((km) => (
              <button
                key={km}
                type="button"
                onClick={() => onChange({ ...values, approachDistanceKm: km })}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                  values.approachDistanceKm === km
                    ? "border-amber-500/70 bg-amber-500/10 text-amber-300"
                    : "border-zinc-700 text-zinc-400 hover:border-amber-700/40 hover:text-amber-200"
                }`}
              >
                {km} km
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Dojazd liczony profilem szosowym (główne drogi). GPX zawiera dojazd,
            pętlę kończącą się w stronę domu oraz powrót tą samą drogą.
          </p>
        </div>
      ) : null}

      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-300">
          Punkt startu
        </label>

        <LocationSearch
          lat={values.lat}
          lng={values.lng}
          onSelect={(location) =>
            onChange({ ...values, lat: location.lat, lng: location.lng })
          }
        />

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onUseMyLocation}
            disabled={locationStatus === "loading"}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
              locationStatus === "ready"
                ? "border-amber-500/60 bg-amber-500/10 text-amber-300"
                : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-700/40"
            }`}
          >
            {locationStatus === "loading" ? "Szukam GPS…" : "Moja lokalizacja"}
          </button>
          <button
            type="button"
            onClick={onTogglePickOnMap}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
              pickOnMap
                ? "border-amber-500 bg-amber-500/10 text-amber-300"
                : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-700/40"
            }`}
          >
            {pickOnMap ? "Kliknij mapę…" : "Ustaw na mapie"}
          </button>
        </div>

        {locationStatus === "denied" ? (
          <p className="mt-2 text-xs text-amber-400/90">
            Brak dostępu do GPS — wyszukaj miejscowość albo ustaw punkt na mapie.
          </p>
        ) : null}

        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-400">
            Współrzędne (zaawansowane)
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="lat"
                className="mb-1 block text-xs font-medium text-zinc-400"
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
                className="mb-1 block text-xs font-medium text-zinc-400"
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
        </details>

        <p className="mt-2 text-[11px] text-zinc-500">
          {waypointsMode
            ? "Zielony — start. Fioletowy z numerem — punkty do zaliczenia (kolejność jazdy)."
            : "Zielony — dom. Pomarańczowy — start pętli. Fioletowy z numerem — przejazd przez. Przy dojeździe GPX kończy się z powrotem w domu (dojazd + pętla + powrót)."}
        </p>
      </div>

      {waypointsMode ? (
        <div className="space-y-3 rounded-lg border border-violet-500/25 bg-zinc-900/60 p-3">
          <div>
            <p className="text-sm font-medium text-zinc-200">
              Punkty do zaliczenia ({viaCount}/{MAX_WAYPOINT_MODE_POINTS})
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Kliknij mapę, aby dodać pinezki. Generator złoży pętlę: start →
              punkty → start. Dystans wynika z trasy.
            </p>
          </div>
          <button
            type="button"
            onClick={onTogglePickViaOnMap}
            disabled={viaCount >= MAX_WAYPOINT_MODE_POINTS}
            className={`w-full rounded-lg border px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
              pickViaOnMap
                ? "border-violet-400 bg-violet-500/15 text-violet-200"
                : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-violet-500/40"
            }`}
          >
            {pickViaOnMap
              ? "Kliknij mapę…"
              : viaCount >= MAX_WAYPOINT_MODE_POINTS
                ? "Limit punktów"
                : "Dodaj punkt na mapie"}
          </button>
          {viaCount === 0 ? (
            <p className="text-xs text-zinc-500">Brak punktów — dodaj przynajmniej jeden.</p>
          ) : (
            <ul className="space-y-2">
              {values.viaPoints.map((point, index) => (
                <li
                  key={`${point.lat}-${point.lng}-${index}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm"
                >
                  <span className="text-zinc-300">
                    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
                      {index + 1}
                    </span>
                    {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...values,
                        viaPoints: values.viaPoints.filter((_, i) => i !== index),
                      })
                    }
                    className="text-xs text-zinc-500 hover:text-red-300"
                  >
                    Usuń
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div>
            <label
              htmlFor="distance"
              className="mb-2 block text-sm font-medium text-zinc-300"
            >
              {values.approachEnabled ? "Dystans pętli (km)" : "Dystans (km)"}
            </label>
            <input
              id="distance"
              type="number"
              min={10}
              max={200}
              step={1}
              value={values.distanceKm}
              onChange={(event) =>
                onChange({ ...values, distanceKm: Number(event.target.value) })
              }
              className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap gap-1.5">
              {DISTANCE_PRESETS.map((km) => (
                <button
                  key={km}
                  type="button"
                  onClick={() => onChange({ ...values, distanceKm: km })}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                    values.distanceKm === km
                      ? "border-amber-500/70 bg-amber-500/10 text-amber-300"
                      : "border-zinc-700 text-zinc-400 hover:border-amber-700/40 hover:text-amber-200"
                  }`}
                >
                  {km} km
                </button>
              ))}
            </div>
            {values.approachEnabled ? (
              <p className="mt-2 text-xs text-zinc-500">
                Szacowany cały wyjazd (dojazd + pętla + powrót): ok.{" "}
                {values.approachDistanceKm * 2 + values.distanceKm} km — odcinek
                pętli w terenie może wyjść krótszy niż cel.
              </p>
            ) : null}
          </div>

          <DirectionCompass
            value={values.direction}
            onChange={(direction) => onChange({ ...values, direction })}
          />

          <ViaPointsEditor
            viaPoints={values.viaPoints}
            routeRequest={{
              start: { lat: values.lat, lng: values.lng },
              direction: values.direction,
              distanceKm: values.distanceKm,
              approachEnabled: values.approachEnabled,
              approachDistanceKm: values.approachDistanceKm,
            }}
            onChange={(viaPoints) => onChange({ ...values, viaPoints })}
          />
        </>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-linear-to-r from-amber-700 via-orange-600 to-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-orange-950/25 transition hover:from-amber-600 hover:via-orange-500 hover:to-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading
          ? "Generuję…"
          : waypointsMode
            ? "Generuj przez punkty"
            : "Generuj pętlę"}
      </button>
    </form>
  );
}
