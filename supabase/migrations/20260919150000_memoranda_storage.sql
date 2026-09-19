-- Private storage for bundled memoranda and teacher-uploaded PDF overrides.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memoranda',
  'memoranda',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.memoranda_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  unit_id text not null,
  file_name text not null check (length(btrim(file_name)) > 0),
  storage_path text not null unique,
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  checksum text not null,
  mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  is_bundled boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((is_bundled and owner_id is null) or (not is_bundled and owner_id is not null))
);

create index if not exists memoranda_files_unit_idx
  on public.memoranda_files (unit_id);

create index if not exists memoranda_files_owner_idx
  on public.memoranda_files (owner_id);

create index if not exists memoranda_files_updated_at_idx
  on public.memoranda_files (owner_id, updated_at);

create index if not exists memoranda_files_active_idx
  on public.memoranda_files (owner_id, unit_id)
  where deleted_at is null;

drop trigger if exists memoranda_files_updated_at on public.memoranda_files;
create trigger memoranda_files_updated_at
before update on public.memoranda_files
for each row execute function public.set_updated_at();

alter table public.memoranda_files enable row level security;

drop policy if exists "memoranda files are visible to owner or authenticated users" on public.memoranda_files;
create policy "memoranda files are visible to owner or authenticated users"
on public.memoranda_files
for select
to authenticated
using (
  deleted_at is null
  and (is_bundled or (select auth.uid()) = owner_id)
);

drop policy if exists "owners manage uploaded memoranda metadata" on public.memoranda_files;
create policy "owners manage uploaded memoranda metadata"
on public.memoranda_files
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id and is_bundled = false);

drop policy if exists "authenticated users read bundled or owned memoranda" on storage.objects;
create policy "authenticated users read bundled or owned memoranda"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'memoranda'
  and (
    name like 'bundled/%'
    or split_part(name, '/', 2) = (select auth.uid())::text
  )
);

drop policy if exists "users upload their memoranda" on storage.objects;
create policy "users upload their memoranda"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'memoranda'
  and split_part(name, '/', 1) = 'users'
  and split_part(name, '/', 2) = (select auth.uid())::text
);

drop policy if exists "users update their memoranda" on storage.objects;
create policy "users update their memoranda"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'memoranda'
  and split_part(name, '/', 1) = 'users'
  and split_part(name, '/', 2) = (select auth.uid())::text
)
with check (
  bucket_id = 'memoranda'
  and split_part(name, '/', 1) = 'users'
  and split_part(name, '/', 2) = (select auth.uid())::text
);

drop policy if exists "users delete their memoranda" on storage.objects;
create policy "users delete their memoranda"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'memoranda'
  and split_part(name, '/', 1) = 'users'
  and split_part(name, '/', 2) = (select auth.uid())::text
);
