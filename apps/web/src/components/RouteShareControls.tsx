"use client";

import { useState } from "react";
import type { StoredRoute } from "@loopforge/osm-types";

function shareUrl(slug: string): string {
  if (typeof window === "undefined") return `/r/${slug}`;
  return `${window.location.origin}/r/${slug}`;
}

export function RouteShareControls({
  route,
  onUpdated,
}: {
  route: StoredRoute;
  onUpdated: (route: StoredRoute) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function setEnabled(enabled: boolean) {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch(`/api/routes/${route.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = (await response.json().catch(() => null)) as {
        route?: StoredRoute;
        error?: string;
      } | null;
      if (!response.ok || !payload?.route) {
        setError(payload?.error ?? "Nie udało się zmienić udostępniania.");
        return;
      }
      onUpdated(payload.route);
    } catch {
      setError("Nie udało się zmienić udostępniania.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!route.shareSlug) return;
    try {
      await navigator.clipboard.writeText(shareUrl(route.shareSlug));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Nie udało się skopiować linku.");
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-950/30 bg-zinc-900/50 p-4">
      <div>
        <h2 className="text-sm font-medium text-zinc-100">Udostępnianie</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Publiczny link z mapą i GPX — bez Twoich notatek i oceny.
        </p>
      </div>

      {route.shareSlug ? (
        <>
          <p className="break-all rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-amber-100/90">
            {shareUrl(route.shareSlug)}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void copyLink()}
              className="flex-1 rounded-lg border border-amber-700/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 transition hover:bg-amber-500/20 disabled:opacity-50"
            >
              {copied ? "Skopiowano" : "Kopiuj link"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void setEnabled(false)}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-red-500/40 hover:text-red-200 disabled:opacity-50"
            >
              Wyłącz
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void setEnabled(true)}
          className="w-full rounded-lg border border-amber-700/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 transition hover:bg-amber-500/20 disabled:opacity-50"
        >
          {busy ? "Chwila…" : "Utwórz link publiczny"}
        </button>
      )}

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
