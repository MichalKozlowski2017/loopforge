"use client";

const STORAGE_KEY = "loopforge:first-run-seen";

export function hasSeenFirstRun(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markFirstRunSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // ignore quota / private mode
  }
}

interface FirstRunDialogProps {
  onDismiss: () => void;
}

export function FirstRunDialog({ onDismiss }: FirstRunDialogProps) {
  function dismiss() {
    markFirstRunSeen();
    onDismiss();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-500/90">
          Loopforge
        </p>
        <h2
          id="first-run-title"
          className="mt-2 text-lg font-semibold text-zinc-100"
        >
          Zanim wygenerujesz pierwszą pętlę
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Krótko i uczciwie — żeby nie było niespodzianek.
        </p>

        <ul className="mt-5 space-y-3 text-sm text-zinc-300">
          <li className="flex gap-3">
            <span className="mt-0.5 shrink-0 text-amber-500" aria-hidden>
              ·
            </span>
            <span>
              <strong className="font-medium text-zinc-100">Konto jest wymagane</strong>{" "}
              do generowania (Google lub Apple). Mapa i ustawienia działają bez
              logowania.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 shrink-0 text-amber-500" aria-hidden>
              ·
            </span>
            <span>
              Trasy idą po sieci OSM (BRouter). Działa globalnie tam, gdzie
              serwer ma segmenty mapy — u nas pokrycie planetarne.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 shrink-0 text-amber-500" aria-hidden>
              ·
            </span>
            <span>
              Generowanie zwykle zajmuje{" "}
              <strong className="font-medium text-zinc-100">ok. 1–2 minuty</strong>
              — dłuższe MTB/gravel bywa wolniejsze. Nie zamykaj karty w trakcie.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 shrink-0 text-amber-500" aria-hidden>
              ·
            </span>
            <span>
              Udane pętle zapisują się w{" "}
              <strong className="font-medium text-zinc-100">historii na koncie</strong>
              — dostępne na innych urządzeniach po zalogowaniu.
            </span>
          </li>
        </ul>

        <button
          type="button"
          onClick={dismiss}
          className="mt-6 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-amber-400"
        >
          Rozumiem, lecimy
        </button>
      </div>
    </div>
  );
}
