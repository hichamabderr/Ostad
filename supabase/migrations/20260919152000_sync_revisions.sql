alter table public.app_settings
  add column if not exists revision bigint not null default 0 check (revision >= 0),
  add column if not exists updated_by_device text;

create table if not exists public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id text,
  local_revision bigint not null,
  remote_revision bigint not null,
  local_device_id text,
  remote_device_id text,
  resolution text not null default 'last-write-wins'
    check (resolution = 'last-write-wins'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists sync_conflicts_owner_created_idx
  on public.sync_conflicts (owner_id, created_at desc);

alter table public.sync_conflicts enable row level security;

create policy "owners read their sync conflicts"
on public.sync_conflicts
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "owners create their sync conflicts"
on public.sync_conflicts
for insert
to authenticated
with check ((select auth.uid()) = owner_id);
