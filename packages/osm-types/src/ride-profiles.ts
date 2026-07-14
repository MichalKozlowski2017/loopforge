import type { BikeType, RideProfile } from "./index";

export interface RideProfileOption {
  value: RideProfile;
  label: string;
  hint: string;
}

export const RIDE_PROFILE_OPTIONS: Record<BikeType, RideProfileOption[]> = {
  road: [
    { value: "fast", label: "Szybki", hint: "Główne drogi i tempo — najkrótsza sensowna trasa" },
    {
      value: "flow",
      label: "Spokojny",
      hint: "Mniej ruchu, cichsze lokalne drogi zamiast ruchliwych łączników",
    },
    {
      value: "technical",
      label: "Boczne drogi",
      hint: "Maksymalne unikanie ruchu — dłużej, ale spokojniej",
    },
  ],
  gravel: [
    { value: "flow", label: "Balans", hint: "Mix szuteru i sensownego asfaltu łączącego" },
    {
      value: "technical",
      label: "Eksploracyjny",
      hint: "Las, polne drogi, doliny — mniej miast",
    },
    { value: "fast", label: "Express", hint: "Szybciej do celu, więcej utwardzonych odcinków" },
  ],
  mtb: [
    { value: "flow", label: "Flow", hint: "Zbalansowany mix ścieżek i leśnych dróg" },
    { value: "technical", label: "Trail", hint: "Więcej singletracku i technicznych odcinków" },
    { value: "fast", label: "XC", hint: "Cross-country — szybsze, bardziej przejezdne drogi" },
  ],
  general: [
    { value: "flow", label: "Turystyczny", hint: "Spokojna pętla, trasy rowerowe i drogi lokalne" },
    { value: "technical", label: "Terenowy", hint: "Więcej szuteru, lasów i dróg polnych" },
    { value: "fast", label: "Asfalt", hint: "Priorytet utwardzonych dróg i szybkich połączeń" },
  ],
};

export function getRideProfileOptions(bikeType: BikeType): RideProfileOption[] {
  return RIDE_PROFILE_OPTIONS[bikeType];
}

export function getRideProfileLabel(
  bikeType: BikeType,
  profile: RideProfile | undefined,
): string | undefined {
  if (!profile) return undefined;
  return RIDE_PROFILE_OPTIONS[bikeType].find((option) => option.value === profile)?.label;
}

export function getRideProfileHint(
  bikeType: BikeType,
  profile: RideProfile,
): string | undefined {
  return RIDE_PROFILE_OPTIONS[bikeType].find((option) => option.value === profile)?.hint;
}
