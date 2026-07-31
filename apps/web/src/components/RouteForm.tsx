"use client";

import { useEffect, useRef, useState } from "react";
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
import { StartPresetsBar } from "@/components/StartPresetsBar";
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

const STEPS = [
  { id: 1 as const, label: "Styl" },
  { id: 2 as const, label: "Trasa" },
  { id: 3 as const, label: "Opcje" },
];

type WizardStep = (typeof STEPS)[number]["id"];

function countPlacedVias(viaPoints: RouteViaPoint[]): number {
  return viaPoints.filter(
    (p) =>
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng) &&
      !(Math.abs(p.lat) < 0.0001 && Math.abs(p.lng) < 0.0001),
  ).length;
}

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
  const [step, setStep] = useState<WizardStep>(1);
  const [stepError, setStepError] = useState<string | null>(null);
  /** Prevent Dalej→Generuj click-through when the footer button swaps in place. */
  const allowGenerateRef = useRef(false);

  const profiles = getRideProfileOptions(values.bikeType);
  const selectedProfile = profiles.find((profile) => profile.value === values.profile);
  const waypointsMode = values.planningMode === "waypoints";
  const viaCount = countPlacedVias(values.viaPoints);

  useEffect(() => {
    if (!stepError) return;
    if (waypointsMode && viaCount >= 1) {
      setStepError(null);
      return;
    }
    if (
      !waypointsMode &&
      Number.isFinite(values.distanceKm) &&
      values.distanceKm >= 10 &&
      values.distanceKm <= 200
    ) {
      setStepError(null);
    }
  }, [stepError, waypointsMode, viaCount, values.distanceKm]);

  function goToStep(next: WizardStep) {
    setStepError(null);
    setStep(next);
    if (next === 3) {
      allowGenerateRef.current = false;
      window.setTimeout(() => {
        allowGenerateRef.current = true;
      }, 400);
    } else {
      allowGenerateRef.current = false;
    }
  }

  function canLeaveStep2(): boolean {
    if (waypointsMode) {
      if (viaCount < 1) {
        setStepError("Dodaj przynajmniej jeden punkt do zaliczenia.");
        return false;
      }
      return true;
    }
    if (
      !Number.isFinite(values.distanceKm) ||
      values.distanceKm < 10 ||
      values.distanceKm > 200
    ) {
      setStepError("Dystans musi być między 10 a 200 km.");
      return false;
    }
    return true;
  }

  function handleNext() {
    if (step === 1) {
      goToStep(2);
      return;
    }
    if (step === 2) {
      if (!canLeaveStep2()) return;
      goToStep(3);
    }
  }

  function handleBack() {
    if (step <= 1) return;
    goToStep((step - 1) as WizardStep);
  }

  function handleGenerateClick() {
    if (step !== 3 || !allowGenerateRef.current || loading) return;
    onSubmit();
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        // Enter in inputs advances steps — never starts generation.
        event.preventDefault();
        if (step < 3) handleNext();
      }}
    >
      <nav aria-label="Kroki generowania" className="flex items-center gap-1.5">
        {STEPS.map((item, index) => {
          const active = step === item.id;
          const reachable = item.id <= step;
          return (
            <div key={item.id} className="flex min-w-0 flex-1 items-center gap-1.5">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => {
                  if (item.id < step) goToStep(item.id);
                }}
                className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-center transition sm:justify-start sm:px-2.5 sm:text-left ${
                  active
                    ? "border-amber-500 bg-amber-500/10 text-amber-200"
                    : reachable
                      ? "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-700/40"
                      : "cursor-not-allowed border-zinc-800 bg-zinc-950 text-zinc-600"
                }`}
              >
                <span
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    active
                      ? "bg-amber-500 text-zinc-950"
                      : reachable
                        ? "bg-zinc-700 text-zinc-200"
                        : "bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {item.id}
                </span>
                <span className="hidden truncate text-xs font-medium sm:inline">
                  {item.label}
                </span>
              </button>
              {index < STEPS.length - 1 ? (
                <span className="hidden shrink-0 text-zinc-700 sm:inline" aria-hidden>
                  ·
                </span>
              ) : null}
            </div>
          );
        })}
      </nav>

      {step === 1 ? (
        <div className="space-y-4">
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
                        mode.value === "waypoints"
                          ? false
                          : values.approachEnabled,
                      viaPoints:
                        mode.value !== values.planningMode
                          ? []
                          : values.viaPoints,
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
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
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

            <StartPresetsBar
              lat={values.lat}
              lng={values.lng}
              onApply={(preset) =>
                onChange({ ...values, lat: preset.lat, lng: preset.lng })
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
                {locationStatus === "loading"
                  ? "Szukam GPS…"
                  : "Moja lokalizacja"}
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
                Brak dostępu do GPS — wyszukaj miejscowość albo ustaw punkt na
                mapie.
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
                ? "Zielony — start. Fioletowy — punkty do zaliczenia."
                : "Zielony — dom/start. Pomarańczowy — wejście w pętlę przy dojeździe."}
            </p>
          </div>

          {waypointsMode ? (
            <div className="space-y-3 rounded-lg border border-violet-500/25 bg-zinc-900/60 p-3">
              <div>
                <p className="text-sm font-medium text-zinc-200">
                  Punkty do zaliczenia ({viaCount}/{MAX_WAYPOINT_MODE_POINTS})
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Start → punkty → start. Dystans wynika z trasy.
                </p>
              </div>
              <LocationSearch
                lat={values.lat}
                lng={values.lng}
                inputId="waypoint-place-search"
                compact
                addPointMode
                placeholder="Szukaj miejsca / adresu do zaliczenia…"
                onSelect={(location) => {
                  const placed = values.viaPoints.filter(
                    (p) =>
                      Number.isFinite(p.lat) &&
                      Number.isFinite(p.lng) &&
                      !(Math.abs(p.lat) < 0.0001 && Math.abs(p.lng) < 0.0001),
                  );
                  if (placed.length >= MAX_WAYPOINT_MODE_POINTS) return;
                  onChange({
                    ...values,
                    viaPoints: [
                      ...placed,
                      {
                        lat: location.lat,
                        lng: location.lng,
                        label: location.label,
                      },
                    ],
                  });
                  setStepError(null);
                }}
              />
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
                  ? "Klikaj mapę… (ponownie = koniec)"
                  : viaCount >= MAX_WAYPOINT_MODE_POINTS
                    ? "Limit punktów"
                    : "Dodawaj punkty na mapie"}
              </button>
              {viaCount === 0 ? (
                <p className="text-xs text-zinc-500">
                  Brak punktów — wyszukaj adres albo kliknij mapę.
                </p>
              ) : (
                <ul className="space-y-2">
                  {values.viaPoints.map((point, index) => (
                    <li
                      key={`${point.lat}-${point.lng}-${index}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-zinc-300">
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
                          {index + 1}
                        </span>
                        <span className="truncate">
                          {point.label ??
                            `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onChange({
                            ...values,
                            viaPoints: values.viaPoints.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                        className="shrink-0 text-xs text-zinc-500 hover:text-red-300"
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
                  Dystans (km)
                </label>
                <input
                  id="distance"
                  type="number"
                  min={10}
                  max={200}
                  step={1}
                  value={values.distanceKm}
                  onChange={(event) => {
                    onChange({
                      ...values,
                      distanceKm: Number(event.target.value),
                    });
                    setStepError(null);
                  }}
                  className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap gap-1.5">
                  {DISTANCE_PRESETS.map((km) => (
                    <button
                      key={km}
                      type="button"
                      onClick={() => {
                        onChange({ ...values, distanceKm: km });
                        setStepError(null);
                      }}
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
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-3">
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
                  Priorytet szutru i leśnych dróg, gdy jest alternatywa.
                </span>
              </span>
            </label>
          ) : null}

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 transition hover:border-amber-800/45">
            <input
              type="checkbox"
              checked={values.preferQuietRoutes}
              onChange={(event) =>
                onChange({
                  ...values,
                  preferQuietRoutes: event.target.checked,
                })
              }
              className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-amber-600 focus:ring-amber-500"
            />
            <span>
              <span className="block text-sm font-medium text-zinc-200">
                Ścieżki i spokojne drogi
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Preferuj ścieżki rowerowe i spokojne ulice.
              </span>
            </span>
          </label>

          {!waypointsMode ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 transition hover:border-amber-800/45">
              <input
                type="checkbox"
                checked={values.approachEnabled}
                onChange={(event) =>
                  onChange({
                    ...values,
                    approachEnabled: event.target.checked,
                  })
                }
                className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-amber-600 focus:ring-amber-500"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-200">
                  Dojazd do pętli
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Szybki dojazd z domu; dystans dotyczy samej pętli.
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
                    onClick={() =>
                      onChange({ ...values, approachDistanceKm: km })
                    }
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
                Cały wyjazd ok.{" "}
                {values.approachDistanceKm * 2 + values.distanceKm} km (dojazd +
                pętla + powrót).
              </p>
            </div>
          ) : null}

          <p className="text-xs text-zinc-500">
            {waypointsMode
              ? `${viaCount} pkt · ${BIKE_TYPES.find((b) => b.value === values.bikeType)?.label ?? values.bikeType}`
              : `${values.distanceKm} km · ${values.direction} · ${BIKE_TYPES.find((b) => b.value === values.bikeType)?.label ?? values.bikeType}`}
          </p>
        </div>
      ) : null}

      {stepError ? (
        <p className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          {stepError}
        </p>
      ) : null}

      <div className="flex gap-2 pt-1">
        {step > 1 ? (
          <button
            type="button"
            onClick={handleBack}
            className="min-h-11 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-300 transition hover:border-amber-700/40 hover:text-amber-100"
          >
            Wstecz
          </button>
        ) : null}

        {step < 3 ? (
          <button
            type="button"
            onClick={handleNext}
            className="min-h-11 flex-1 rounded-lg bg-linear-to-r from-amber-700 via-orange-600 to-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-orange-950/25 transition hover:from-amber-600 hover:via-orange-500 hover:to-amber-400"
          >
            Dalej
          </button>
        ) : (
          <button
            type="button"
            disabled={loading}
            onClick={handleGenerateClick}
            className="min-h-11 flex-1 rounded-lg bg-linear-to-r from-amber-700 via-orange-600 to-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-orange-950/25 transition hover:from-amber-600 hover:via-orange-500 hover:to-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? "Generuję…"
              : waypointsMode
                ? "Generuj przez punkty"
                : "Generuj pętlę"}
          </button>
        )}
      </div>
    </form>
  );
}
