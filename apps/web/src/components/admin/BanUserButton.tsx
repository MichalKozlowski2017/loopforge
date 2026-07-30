"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function BanUserButton({
  userId,
  banned,
}: {
  userId: string;
  banned: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/users/${userId}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banned: !banned }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(payload?.error ?? "Błąd");
        return;
      }
      router.refresh();
    } catch {
      setError("Błąd sieci");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
          banned
            ? "border-emerald-700/50 text-emerald-300 hover:bg-emerald-950/40"
            : "border-red-700/40 text-red-300 hover:bg-red-950/40"
        }`}
      >
        {busy ? "…" : banned ? "Odbanuj" : "Ban"}
      </button>
      {error ? <span className="text-[10px] text-red-400">{error}</span> : null}
    </div>
  );
}
