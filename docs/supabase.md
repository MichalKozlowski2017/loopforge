# Supabase — projekt loopforge

| | |
|---|---|
| **Dashboard** | https://supabase.com/dashboard/project/ivaarrzxpoffwbmvwitc |
| **Project ref** | `ivaarrzxpoffwbmvwitc` |
| **Region** | eu-central-1 (Frankfurt) |

## Rola Supabase

Supabase służy **tylko aplikacji** — auth, zapis tras (`public.routes`), metadata. **OSM i routing** → BRouter (lokalnie / osobny serwer).

## Migracje (zastosowane)

- PostGIS, pgRouting, hstore (pgRouting opcjonalnie na przyszłość)
- `public.routes`, `loopforge.import_status`, puste `loopforge.ways`
- RLS na tabelach aplikacyjnych

## Setup

```bash
supabase login
supabase link --project-ref ivaarrzxpoffwbmvwitc
pnpm setup:supabase   # klucze API + DATABASE_URL (opcjonalnie, do zapisu tras)
pnpm setup:brouter    # routing OSM
pnpm brouter          # serwer :17777
```

W `.env.local`: `ROUTING_ENGINE=brouter`

## Czyszczenie OSM z bazy (jeśli kiedyś znów zaimportujesz testowo)

```bash
pnpm drop:osm
```

Usuwa `planet_osm_*`, `osm2pgsql_properties` i czyści `loopforge.ways`.

## Supabase CLI

```bash
supabase db push
```
