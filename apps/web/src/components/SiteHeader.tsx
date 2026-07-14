import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="flex items-center justify-between border-b border-amber-950/35 bg-zinc-950/80 px-4 py-3 backdrop-blur-sm">
      <Link
        href="/"
        className="flex items-center gap-2.5 transition opacity-100 hover:opacity-90"
      >
        <img
          src="/branding/loopforge-icon.svg"
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 shrink-0"
        />
        <span className="text-sm font-semibold tracking-wide text-white">
          Loopforge
        </span>
      </Link>
      <nav className="flex gap-4 text-sm text-zinc-400">
        <Link href="/" className="transition hover:text-amber-200">
          Generator
        </Link>
        <Link href="/routes" className="transition hover:text-amber-200">
          Historia
        </Link>
      </nav>
    </header>
  );
}
