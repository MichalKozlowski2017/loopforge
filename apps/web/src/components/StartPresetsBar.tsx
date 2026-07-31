"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { StartPreset } from "@/lib/cloud-presets-store";
import { MAX_START_PRESETS } from "@/lib/cloud-presets-store";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

interface StartPresetsBarProps {
  lat: number;
  lng: number;
  onApply: (preset: Pick<StartPreset, "lat" | "lng" | "label">) => void;
}

export function StartPresetsBar({ lat, lng, onApply }: StartPresetsBarProps) {
  const configured = isSupabaseConfigured();
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [presets, setPresets] = useState<StartPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) {
      setReady(true);
      return;
    }

    let cancelled = false;
    const supabase = createClient();

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;

      if (!user) {
        setLoggedIn(false);
        setReady(true);
        return;
      }

      setLoggedIn(true);
      try {
        const response = await fetch("/api/presets");
        if (response.status === 401) {
          if (!cancelled) {
            setLoggedIn(false);
            setReady(true);
          }
          return;
        }
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (!cancelled) {
            setError(payload?.error ?? "Nie udało się wczytać startów.");
            setReady(true);
          }
          return;
        }
        const payload = (await response.json()) as { presets?: StartPreset[] };
        if (!cancelled) {
          setPresets(payload.presets ?? []);
          setReady(true);
        }
      } catch {
        if (!cancelled) {
          setError("Nie udało się wczytać startów.");
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [configured]);

  if (!configured || !ready) return null;

  if (!loggedIn) {
    return (
      <p className="mt-2 text-[11px] text-zinc-500">
        <Link href="/login" className="text-amber-400/90 hover:underline">
          Zaloguj się
        </Link>
        , żeby zapisać ulubione punkty startu.
      </p>
    );
  }

  async function handleSave() {
    const trimmed = label.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed, lat, lng }),
      });
      const payload = (await response.json().catch(() => null)) as {
        preset?: StartPreset;
        error?: string;
      } | null;
      if (!response.ok || !payload?.preset) {
        setError(payload?.error ?? "Nie udało się zapisać.");
        return;
      }
      setPresets((prev) => [...prev, payload.preset!]);
      setLabel("");
      setNaming(false);
    } catch {
      setError("Nie udało się zapisać.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/presets/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(payload?.error ?? "Nie udało się usunąć.");
        return;
      }
      setPresets((prev) => prev.filter((p) => p.id !== id));
    } catch {
      setError("Nie udało się usunąć.");
    } finally {
      setBusyId(null);
    }
  }

  const atLimit = presets.length >= MAX_START_PRESETS;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-400">Zapisane starty</p>
        {!naming ? (
          <button
            type="button"
            disabled={atLimit}
            onClick={() => {
              setNaming(true);
              setError(null);
            }}
            className="text-xs text-amber-400/90 transition hover:text-amber-300 disabled:cursor-not-allowed disabled:text-zinc-600"
          >
            {atLimit ? `Limit ${MAX_START_PRESETS}` : "Zapisz ten punkt"}
          </button>
        ) : null}
      </div>

      {presets.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <li key={preset.id} className="flex max-w-full items-center">
              <button
                type="button"
                title={`${preset.lat.toFixed(4)}, ${preset.lng.toFixed(4)}`}
                onClick={() =>
                  onApply({
                    lat: preset.lat,
                    lng: preset.lng,
                    label: preset.label,
                  })
                }
                className="max-w-40 truncate rounded-l-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 transition hover:border-amber-700/50 hover:text-amber-100"
              >
                {preset.label}
              </button>
              <button
                type="button"
                aria-label={`Usuń ${preset.label}`}
                disabled={busyId === preset.id}
                onClick={() => void handleDelete(preset.id)}
                className="rounded-r-lg border border-l-0 border-zinc-700 bg-zinc-900 px-1.5 py-1.5 text-xs text-zinc-500 transition hover:border-red-800/60 hover:text-red-300 disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : !naming ? (
        <p className="text-[11px] text-zinc-500">
          Ustaw punkt i zapisz np. „Z domu”.
        </p>
      ) : null}

      {naming ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={label}
            maxLength={60}
            placeholder="Np. Z domu"
            autoFocus
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSave();
              }
              if (event.key === "Escape") {
                setNaming(false);
                setLabel("");
              }
            }}
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={saving || !label.trim()}
            onClick={() => void handleSave()}
            className="rounded-lg border border-amber-700/50 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "…" : "OK"}
          </button>
          <button
            type="button"
            onClick={() => {
              setNaming(false);
              setLabel("");
              setError(null);
            }}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition hover:text-zinc-200"
          >
            Anuluj
          </button>
        </div>
      ) : null}

      {error ? <p className="text-xs text-amber-400/90">{error}</p> : null}
    </div>
  );
}
