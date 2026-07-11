-- Stored routes (production persistence)
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  bike_type text not null check (bike_type in ('road', 'gravel', 'mtb', 'general')),
  direction text not null,
  profile text,
  start_lat double precision not null,
  start_lng double precision not null,
  geojson jsonb not null,
  map_geojson jsonb,
  metrics jsonb not null,
  gpx text not null default '',
  rating text check (rating in ('up', 'down')),
  notes text,
  created_at timestamptz not null default now()
);

create index routes_created_at_idx on public.routes (created_at desc);

alter table public.routes enable row level security;

-- Closed MVP: no public API access yet (service role / server-side only)
create policy "routes_service_role_all"
  on public.routes
  for all
  to service_role
  using (true)
  with check (true);

-- Authenticated users (Phase 2) can read/write own routes — placeholder
create policy "routes_authenticated_read"
  on public.routes
  for select
  to authenticated
  using (true);

create policy "routes_authenticated_insert"
  on public.routes
  for insert
  to authenticated
  with check (true);

create policy "routes_authenticated_update"
  on public.routes
  for update
  to authenticated
  using (true)
  with check (true);

-- Import metadata
create table loopforge.import_status (
  id int primary key default 1 check (id = 1),
  region text not null,
  osm_file text,
  ways_count bigint,
  imported_at timestamptz not null default now()
);

alter table loopforge.import_status enable row level security;

create policy "import_status_service_role"
  on loopforge.import_status
  for all
  to service_role
  using (true)
  with check (true);

grant select on loopforge.import_status to postgres, service_role;
