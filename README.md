# Loopforge

Generator tras rowerowych dla Polski — szosa, gravel, MTB, ogólny.

**Domeny:** [loopforge.pl](https://loopforge.pl) · [loopforge.eu](https://loopforge.eu)

## Status

Przejście na **docelową infrastrukturę** — Supabase + pgRouting (testy terenowe = produkcja).

## Dokumentacja

Wszystkie plany i instrukcje są w [`docs/`](./docs/README.md).

| Dokument | Opis |
|---|---|
| [docs/plan.md](./docs/plan.md) | Pełny plan produktu i architektury |
| [docs/phases.md](./docs/phases.md) | Fazy wdrożenia — checklist |
| [docs/setup.md](./docs/setup.md) | Supabase + pgRouting + import OSM |
| [docs/github.md](./docs/github.md) | Podpięcie repozytorium GitHub |

## Stack (skrót)

- **Frontend:** Next.js 16, MapLibre, Tailwind
- **Routing:** pgRouting na Supabase (produkcja i dev)
- **Deploy:** Vercel Pro + Supabase Pro
- **Fallback dev:** BRouter (opcjonalnie)
- **Monorepo:** pnpm workspaces

## Szybki start

```bash
pnpm install
supabase start && pnpm db:push:local
cp apps/web/.env.example apps/web/.env.local
pnpm import:osm:mazowsze   # pierwszy import OSM
pnpm dev                   # http://localhost:3000
```

Szczegóły: [docs/setup.md](./docs/setup.md).
