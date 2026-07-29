-- Clean slate: wipe orphan routes / routing leftovers, rebuild routes owned by auth.users.

truncate table public.routes;
truncate table loopforge.ways;
delete from loopforge.import_status;

drop policy if exists "routes_authenticated_read" on public.routes;
drop policy if exists "routes_authenticated_insert" on public.routes;
drop policy if exists "routes_authenticated_update" on public.routes;
drop policy if exists "routes_service_role_all" on public.routes;

drop index if exists routes_created_at_idx;

alter table public.routes
  add column if not exists user_id uuid;

-- Table may still have orphan rows after add; truncate again then enforce NOT NULL.
truncate table public.routes;

alter table public.routes
  alter column user_id set not null;

alter table public.routes
  drop constraint if exists routes_user_id_fkey;

alter table public.routes
  add constraint routes_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

create index routes_user_created_at_idx
  on public.routes (user_id, created_at desc);

alter table public.routes enable row level security;

create policy "routes_service_role_all"
  on public.routes
  for all
  to service_role
  using (true)
  with check (true);

create policy "routes_select_own"
  on public.routes
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "routes_insert_own"
  on public.routes
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "routes_update_own"
  on public.routes
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "routes_delete_own"
  on public.routes
  for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.routes to authenticated;
grant all on public.routes to service_role;
