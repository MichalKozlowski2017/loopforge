-- RLS: routing graph is server-side only (service role / DATABASE_URL)
alter table loopforge.ways enable row level security;

create policy "ways_service_role_all"
  on loopforge.ways
  for all
  to service_role
  using (true)
  with check (true);
