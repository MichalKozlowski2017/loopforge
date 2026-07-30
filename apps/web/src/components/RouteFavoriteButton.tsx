"use client";

import { useState } from "react";
import type { StoredRoute } from "@loopforge/osm-types";

export function RouteFavoriteButton({
  route,
  onUpdated,
}: {
  route: StoredRoute;
  onUpdated: (route: StoredRoute) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFavorite = Boolean(route.isFavorite);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/routes/${route.id}/favorite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !isFavorite }),
      });
      const payload = (await response.json().catch(() => null)) as {
        route?: StoredRoute;
        error?: string;
      } | null;
      if (!response.ok || !payload?.route) {
        setError(payload?.error ?? "Nie udało się zapisać ulubionej.");
        return;
      }
      onUpdated(payload.route);
    } catch {
      setError("Nie udało się zapisać ulubionej.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        aria-pressed={isFavorite}
        className={`w-full rounded-lg border px-3 py-2 text-sm transition disabled:opacity-50 ${
          isFavorite
            ? "border-amber-500/60 bg-amber-500/15 text-amber-100"
            : "border-zinc-700 text-zinc-300 hover:border-amber-700/40 hover:text-amber-100"
        }`}
      >
        {busy
          ? "Chwila…"
          : isFavorite
            ? "★ W ulubionych — usuń"
            : "☆ Zapisz w ulubionych"}
      </button>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
