-- Saved start locations per user (e.g. "Z domu", "Parking Wisła").

create table if not exists public.start_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  lat double precision not null,
  lng double precision not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint start_presets_label_len check (
    char_length(trim(label)) >= 1 and char_length(label) <= 60
  ),
  constraint start_presets_lat_range check (lat >= -90 and lat <= 90),
  constraint start_presets_lng_range check (lng >= -180 and lng <= 180)
);

create index if not exists start_presets_user_sort_idx
  on public.start_presets (user_id, sort_order asc, created_at asc);

alter table public.start_presets enable row level security;

create policy "start_presets_service_role_all"
  on public.start_presets
  for all
  to service_role
  using (true)
  with check (true);

create policy "start_presets_select_own"
  on public.start_presets
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "start_presets_insert_own"
  on public.start_presets
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "start_presets_update_own"
  on public.start_presets
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "start_presets_delete_own"
  on public.start_presets
  for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.start_presets to authenticated;
grant all on public.start_presets to service_role;
