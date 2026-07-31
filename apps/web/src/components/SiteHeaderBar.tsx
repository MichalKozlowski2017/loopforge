"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { AuthControls } from "@/components/AuthControls";

const NAV_LINKS = [
  { href: "/", label: "Generator" },
  { href: "/routes", label: "Historia" },
  { href: "/routes/favorites", label: "Ulubione" },
] as const;

export function SiteHeaderBar({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function close() {
    setOpen(false);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-amber-950/35 bg-zinc-950/95 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          href="/"
          onClick={close}
          className="flex min-w-0 items-center gap-2.5 transition hover:opacity-90"
        >
          <img
            src="/branding/loopforge-icon.svg"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 shrink-0"
          />
          <span className="truncate text-sm font-semibold tracking-wide text-white">
            Loopforge
          </span>
        </Link>

        <div className="hidden items-center gap-4 md:flex">
          <nav className="flex gap-4 text-sm text-zinc-400">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="transition hover:text-amber-200"
              >
                {link.label}
              </Link>
            ))}
            {isAdmin ? (
              <Link href="/admin" className="transition hover:text-amber-200">
                Admin
              </Link>
            ) : null}
          </nav>
          <AuthControls />
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 text-zinc-200 transition hover:border-amber-700/50 hover:text-amber-100 md:hidden"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Zamknij menu" : "Otwórz menu"}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="sr-only">{open ? "Zamknij" : "Menu"}</span>
          <span className="relative block h-3.5 w-4" aria-hidden>
            <span
              className={`absolute left-0 block h-0.5 w-4 rounded-full bg-current transition ${
                open ? "top-1.5 rotate-45" : "top-0"
              }`}
            />
            <span
              className={`absolute left-0 top-1.5 block h-0.5 w-4 rounded-full bg-current transition ${
                open ? "opacity-0" : "opacity-100"
              }`}
            />
            <span
              className={`absolute left-0 block h-0.5 w-4 rounded-full bg-current transition ${
                open ? "top-1.5 -rotate-45" : "top-3"
              }`}
            />
          </span>
        </button>
      </div>

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-zinc-950/70 md:hidden"
            aria-label="Zamknij menu"
            onClick={close}
          />
          <div
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Menu nawigacji"
            className="absolute inset-x-0 top-full z-50 border-b border-amber-950/35 bg-zinc-950 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-xl md:hidden"
          >
            <nav className="flex flex-col gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={close}
                  className="rounded-lg px-3 py-3.5 text-base font-medium text-zinc-100 transition hover:bg-zinc-900 hover:text-amber-100"
                >
                  {link.label}
                </Link>
              ))}
              {isAdmin ? (
                <Link
                  href="/admin"
                  onClick={close}
                  className="rounded-lg px-3 py-3.5 text-base font-medium text-zinc-100 transition hover:bg-zinc-900 hover:text-amber-100"
                >
                  Admin
                </Link>
              ) : null}
            </nav>
            <div className="mt-3 border-t border-zinc-800 pt-3">
              <AuthControls className="w-full justify-between" />
            </div>
          </div>
        </>
      ) : null}
    </header>
  );
}
