# Loopforge

Generator tras rowerowych dla Polski — szosa, gravel, MTB, ogólny.

**Domeny:** [loopforge.pl](https://loopforge.pl) · [loopforge.eu](https://loopforge.eu)

## Status

Zamknięty MVP — Faza 0 (lokalny dev, mapa + BRouter).

## Dokumentacja

Wszystkie plany i instrukcje są w [`docs/`](./docs/README.md).

| Dokument | Opis |
|---|---|
| [docs/plan.md](./docs/plan.md) | Pełny plan produktu i architektury |
| [docs/phases.md](./docs/phases.md) | Fazy wdrożenia — checklist |
| [docs/setup.md](./docs/setup.md) | Środowisko lokalne (Node, Java, BRouter) |
| [docs/github.md](./docs/github.md) | Podpięcie repozytorium GitHub |

## Stack (skrót)

- **Frontend:** Next.js 15, MapLibre, Tailwind + shadcn/ui
- **Faza 0 routing:** BRouter (lokalnie, Java)
- **Produkcja:** Vercel Pro + Supabase (PostGIS + pgRouting)
- **Monorepo:** pnpm workspaces

## Szybki start

```bash
pnpm install
pnpm dev   # apps/web → http://localhost:3000
```

Faza 0 używa placeholder generatora (geometryczna pętla). BRouter — opcjonalnie, patrz [docs/setup.md](./docs/setup.md).
