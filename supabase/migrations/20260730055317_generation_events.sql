-- Ops log for route generation (admin-only via service_role).

create table public.generation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  bike_type text,
  distance_km double precision,
  direction text,
  profile text,
  approach_enabled boolean not null default false,
  start_lat double precision,
  start_lng double precision,
  status text not null check (status in ('success', 'error')),
  latency_ms integer,
  error_message text,
  route_id uuid
);

create index generation_events_created_at_idx
  on public.generation_events (created_at desc);

create index generation_events_user_created_at_idx
  on public.generation_events (user_id, created_at desc);

create index generation_events_status_created_at_idx
  on public.generation_events (status, created_at desc);

alter table public.generation_events enable row level security;

-- No policies for anon/authenticated — service_role bypasses RLS.
create policy "generation_events_service_role_all"
  on public.generation_events
  for all
  to service_role
  using (true)
  with check (true);

grant all on public.generation_events to service_role;
revoke all on public.generation_events from anon, authenticated;
