"use client";

import { useState, type FormEvent } from "react";
import type { RouteRating, StoredRoute } from "@loopforge/osm-types";
import {
  ROUTE_FEEDBACK_TAGS,
  type RouteFeedbackTagId,
} from "@/lib/route-feedback";

const STARS: RouteRating[] = [1, 2, 3, 4, 5];

export function RouteFeedbackForm({
  routeId,
  initialRating,
  initialTags,
  initialNotes,
  onSaved,
}: {
  routeId: string;
  initialRating?: RouteRating;
  initialTags?: string[];
  initialNotes?: string;
  onSaved?: (route: StoredRoute) => void;
}) {
  const [rating, setRating] = useState<RouteRating | null>(initialRating ?? null);
  const [tags, setTags] = useState<RouteFeedbackTagId[]>(
    (initialTags ?? []).filter((t): t is RouteFeedbackTagId =>
      ROUTE_FEEDBACK_TAGS.some((known) => known.id === t),
    ),
  );
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(Boolean(initialRating));

  function toggleTag(id: RouteFeedbackTagId) {
    setTags((current) =>
      current.includes(id) ? current.filter((t) => t !== id) : [...current, id],
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!rating) {
      setError("Wybierz ocenę od 1 do 5.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/routes/${routeId}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, notes, tags }),
      });
      const payload = (await response.json().catch(() => null)) as {
        route?: StoredRoute;
        error?: string;
      } | null;
      if (!response.ok) {
        setError(payload?.error ?? "Nie udało się zapisać oceny.");
        return;
      }
      if (payload?.route) {
        setSaved(true);
        onSaved?.(payload.route);
      }
    } catch {
      setError("Nie udało się zapisać oceny.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      id="feedback"
      onSubmit={handleSubmit}
      className="scroll-mt-6 space-y-4 rounded-xl border border-amber-950/30 bg-zinc-900/50 p-4"
    >
      <div>
        <h2 className="text-sm font-medium text-zinc-100">Po przejeździe</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Oceń trasę dopiero po jeździe — to pomaga poprawiać generator.
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-zinc-400">Ocena (1–5)</p>
        <div className="flex gap-1">
          {STARS.map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              aria-label={`Ocena ${star}`}
              className={`h-10 w-10 rounded-lg border text-sm font-semibold transition ${
                rating != null && rating >= star
                  ? "border-amber-500 bg-amber-500/15 text-amber-300"
                  : "border-zinc-700 text-zinc-500 hover:border-amber-700/40 hover:text-amber-100"
              }`}
            >
              {star}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-zinc-400">
          Co było nie tak? (opcjonalnie)
        </p>
        <div className="flex flex-wrap gap-2">
          {ROUTE_FEEDBACK_TAGS.map((tag) => {
            const active = tags.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                  active
                    ? "border-amber-500/60 bg-amber-500/10 text-amber-100"
                    : "border-zinc-700 text-zinc-400 hover:border-amber-700/40 hover:text-amber-100"
                }`}
              >
                {tag.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label
          htmlFor="feedback-notes"
          className="mb-1 block text-xs font-medium text-zinc-400"
        >
          Notatka (opcjonalnie)
        </label>
        <textarea
          id="feedback-notes"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="np. piękne szutry do km 20, potem za dużo DK…"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {saved && !error ? (
        <p className="text-sm text-emerald-400">Ocena zapisana. Możesz ją zmienić.</p>
      ) : null}

      <button
        type="submit"
        disabled={saving || rating == null}
        className="w-full rounded-lg border border-amber-700/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Zapisywanie…" : saved ? "Zaktualizuj ocenę" : "Zapisz ocenę"}
      </button>
    </form>
  );
}
