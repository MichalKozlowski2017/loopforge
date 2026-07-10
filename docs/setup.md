# Środowisko lokalne — Faza 0

## Wymagania

| Narzędzie | Wersja | Po co |
|---|---|---|
| Node.js | 22.x | Next.js, pakiety TS |
| pnpm | 9+ | Monorepo workspaces |
| Java | 17+ | BRouter JAR |
| Supabase CLI | opcjonalnie na F0 | Migracje od Fazy 1 |

Sprawdzenie:

```bash
node -v    # v22.x
pnpm -v
java -version
```

## BRouter (Faza 0)

```bash
pnpm setup:brouter   # pobiera JAR + segmenty PL, tworzy .env.local
pnpm dev             # BRouter startuje automatycznie przy generowaniu
```

Opcjonalnie osobny terminal:

```bash
pnpm brouter
```

### Ręczna instalacja

1. Pobierz BRouter 1.7.x z [brouter.de](http://brouter.de/brouter/en/) lub `pnpm setup:brouter`
2. Segmenty `.rd5` dla Polski: `E15_N50`, `E20_N50` (Warszawa i okolice)
3. `apps/web/.env.local`:

```bash
BROUTER_JAR=../../infra/brouter/brouter-1.7.9/brouter-1.7.9-all.jar
BROUTER_SEGMENTS_DIR=../../infra/brouter/segments4
BROUTER_PROFILES_DIR=../../infra/brouter/brouter-1.7.9/profiles2
BROUTER_CUSTOM_PROFILES_DIR=../../infra/brouter/customprofiles
BROUTER_PORT=17777
```

Profile BRouter (`.brf`): `gravel`, `fastbike`, `mtb`, `trekking` — mapowane na tryby Loopforge.

## Zmienne środowiskowe (Faza 0)

Plik `apps/web/.env.local`:

```bash
# Faza 0 — BRouter (patrz pnpm setup:brouter)
BROUTER_JAR=../../infra/brouter/brouter-1.7.9/brouter-1.7.9-all.jar
BROUTER_SEGMENTS_DIR=../../infra/brouter/segments4
BROUTER_PROFILES_DIR=../../infra/brouter/brouter-1.7.9/profiles2
BROUTER_CUSTOM_PROFILES_DIR=../../infra/brouter/customprofiles
```

## Zmienne (Faza 1+)

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=                    # Supabase pooler — pgRouting
ALLOWED_EMAILS=twoj@email.pl
```

## Uruchomienie dev

```bash
cd /Users/michal/Sites/loopforge
pnpm install
pnpm dev
```

→ [http://localhost:3000](http://localhost:3000)

## Struktura monorepo (docelowa)

```
loopforge/
├── apps/web/           # Next.js
├── apps/cli/           # debug CLI (opcjonalnie)
├── packages/
│   ├── scoring/        # wagi per tryb jazdy
│   ├── generator/      # algorytm pętli
│   ├── osm-types/
│   └── gpx/
├── infra/
│   ├── brouter-profiles/
│   └── scripts/
├── supabase/migrations/
├── data/routes.json    # Faza 0 — lokalny zapis tras
└── docs/
```

## Vercel (Faza 1)

`apps/web/vercel.json`:

```json
{
  "functions": {
    "app/api/routes/generate/route.ts": {
      "maxDuration": 300,
      "memory": 1024
    }
  }
}
```

## DNS loopforge.pl (Faza 1)

1. Vercel → Project → Settings → Domains → dodaj `loopforge.pl`
2. U registrara domeny ustaw rekordy jak wskazuje Vercel (zwykle A/CNAME)
3. SSL — automatycznie przez Vercel

`loopforge.eu` — redirect 301 na `loopforge.pl` u registrara lub w Vercel.
