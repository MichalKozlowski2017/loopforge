import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_START_PRESETS = 12;

export interface StartPreset {
  id: string;
  label: string;
  lat: number;
  lng: number;
  sortOrder: number;
  createdAt: string;
}

type PresetRow = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  sort_order: number;
  created_at: string;
};

function rowToPreset(row: PresetRow): StartPreset {
  return {
    id: row.id,
    label: row.label,
    lat: row.lat,
    lng: row.lng,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

const SELECT =
  "id, label, lat, lng, sort_order, created_at" as const;

export async function listStartPresets(
  supabase: SupabaseClient,
  userId: string,
): Promise<StartPreset[]> {
  const { data, error } = await supabase
    .from("start_presets")
    .select(SELECT)
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(MAX_START_PRESETS);

  if (error) throw new Error(error.message);
  return (data as PresetRow[] | null)?.map(rowToPreset) ?? [];
}

export async function createStartPreset(
  supabase: SupabaseClient,
  userId: string,
  input: { label: string; lat: number; lng: number },
): Promise<StartPreset> {
  const label = input.label.trim();
  if (!label || label.length > 60) {
    throw new Error("Nazwa musi mieć 1–60 znaków.");
  }
  if (
    !Number.isFinite(input.lat) ||
    !Number.isFinite(input.lng) ||
    input.lat < -90 ||
    input.lat > 90 ||
    input.lng < -180 ||
    input.lng > 180
  ) {
    throw new Error("Nieprawidłowe współrzędne.");
  }

  const existing = await listStartPresets(supabase, userId);
  if (existing.length >= MAX_START_PRESETS) {
    throw new Error(
      `Możesz mieć max. ${MAX_START_PRESETS} zapisanych startów.`,
    );
  }

  const sortOrder =
    existing.length === 0
      ? 0
      : Math.max(...existing.map((p) => p.sortOrder)) + 1;

  const { data, error } = await supabase
    .from("start_presets")
    .insert({
      user_id: userId,
      label,
      lat: input.lat,
      lng: input.lng,
      sort_order: sortOrder,
    })
    .select(SELECT)
    .single();

  if (error) throw new Error(error.message);
  return rowToPreset(data as PresetRow);
}

export async function deleteStartPreset(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from("start_presets")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}
