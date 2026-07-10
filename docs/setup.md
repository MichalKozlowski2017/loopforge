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

1. Pobierz BRouter 1.7.x z [brouter.de](http://brouter.de/brouter/en/)
2. Rozpakuj JAR + segmenty dla Europy/Polski
3. Ustaw w `.env.local`:

```bash
BROUTER_PATH=/ścieżka/do/brouter.jar
BROUTER_SEGMENTS_DIR=/ścieżka/do/segments4
BROUTER_PROFILES_DIR=./infra/brouter-profiles
```

4. Profile w `infra/brouter-profiles/`: `road.xml`, `gravel.xml`, `mtb.xml`, `general.xml`

## Zmienne środowiskowe (Faza 0)

Plik `apps/web/.env.local`:

```bash
# Faza 0 — tylko BRouter, bez Supabase
BROUTER_PATH=
BROUTER_SEGMENTS_DIR=
BROUTER_PROFILES_DIR=../../infra/brouter-profiles
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
