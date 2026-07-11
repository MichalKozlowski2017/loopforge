# Środowisko — docelowa infrastruktura (Faza 1)

Testujemy na **Supabase + pgRouting** — tym samym stacku co produkcja. BRouter pozostaje opcjonalnym fallbackiem lokalnym.

## Wymagania

| Narzędzie | Po co |
|---|---|
| Node.js 22 + pnpm 9 | Next.js, monorepo |
| [Supabase CLI](https://supabase.com/docs/guides/cli) | Lokalna baza + migracje |
| [osm2pgsql](https://osm2pgsql.org/) | Import OSM → Postgres |
| Docker Desktop | Supabase local (`supabase start`) |

```bash
brew install supabase/tap/supabase osm2pgsql
```

## Szybki start (lokalnie = produkcja architektonicznie)

```bash
cd loopforge
pnpm install

# 1. Supabase local
supabase start
pnpm db:push:local

# 2. Env
cp apps/web/.env.example apps/web/.env.local
# DATABASE_URL z `supabase status` (port 54322)

# 3. Import OSM — zacznij od Mazowsza (~15 min), potem cała Polska
pnpm import:osm:mazowsze
# pnpm import:osm          # poland-latest — 20–90 min

# 4. Dev
pnpm dev
```

→ [http://localhost:3000](http://localhost:3000)

Generator używa pgRouting gdy `loopforge.ways` ma dane. Ustaw `ROUTING_ENGINE=pgrouting` żeby wymusić (domyślnie `auto`).

## Zmienne środowiskowe

`apps/web/.env.local`:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
ROUTING_ENGINE=pgrouting

# Vercel / Supabase cloud (po deployu)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Na Vercel użyj **connection pooler** Supabase (Transaction mode) jako `DATABASE_URL`.

## Deploy produkcyjny

1. **Supabase Pro** — włącz PostGIS + pgRouting (Extensions w dashboardzie)
2. `supabase link` + `pnpm db:push` — migracje
3. Import OSM na instancji (Hetzner VM / GitHub Actions z `DATABASE_URL`) — `pnpm import:osm`
4. **Vercel Pro** — deploy `apps/web`, env z Supabase
5. DNS `loopforge.pl` → Vercel

`apps/web/vercel.json` — `maxDuration: 300` na `/api/routes/generate`.

## BRouter (opcjonalny fallback)

Tylko gdy brak `DATABASE_URL` lub `ROUTING_ENGINE=brouter`:

```bash
pnpm setup:brouter
pnpm brouter
```

## Struktura

```
loopforge/
├── apps/web/              # Next.js + API
├── packages/
│   ├── routing/           # pgRouting client (produkcja)
│   ├── generator/         # algorytm pętli
│   ├── scoring/           # wagi OSM
│   └── brouter/           # fallback Faza 0
├── supabase/migrations/   # PostGIS, pgRouting, routes
├── infra/sql/build-ways.sql
└── infra/scripts/import-osm.sh
```

Szczegóły produktu: [plan.md](./plan.md), [phases.md](./phases.md).
