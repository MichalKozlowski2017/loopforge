# Supabase — projekt loopforge

| | |
|---|---|
| **Dashboard** | https://supabase.com/dashboard/project/ivaarrzxpoffwbmvwitc |
| **Project ref** | `ivaarrzxpoffwbmvwitc` |
| **Region** | eu-central-1 (Frankfurt) |

## Rola Supabase

Supabase służy **tylko aplikacji** — auth, zapis tras (`public.routes`), metadata. **OSM i routing** → BRouter (lokalnie / osobny serwer).

Logowanie Google/Apple: [docs/auth.md](./auth.md).  
Panel admina: [docs/admin.md](./admin.md).

## Migracje (zastosowane)

- PostGIS, pgRouting, hstore (pgRouting opcjonalnie na przyszłość)
- `public.routes` z `user_id` → `auth.users` (historia per konto, RLS `auth.uid()`)
- `loopforge.import_status`, puste `loopforge.ways`
- Orphan trasy bez właściciela skasowane przy migracji `routes_user_owned` (2026-07-29)

Historia w aplikacji **nie** wymaga `DATABASE_URL` — zapis idzie przez sesję Supabase (anon key + cookies). `DATABASE_URL` zostaje opcjonalne pod pgRouting / tooling.
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
