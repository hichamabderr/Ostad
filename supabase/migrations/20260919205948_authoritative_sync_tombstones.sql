-- Server-authoritative sync metadata. Development data is disposable.
create table if not exists public.sync_tombstones (
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('class','student','grade','session','timetable','lessonProgress','customUnit','lessonPlan')),
  entity_id text not null,
  deleted_at timestamptz not null,
  revision bigint not null default 0 check (revision >= 0),
  device_id text,
  primary key (owner_id, entity_type, entity_id)
);

alter table public.sync_tombstones enable row level security;
drop policy if exists "owners manage sync tombstones" on public.sync_tombstones;
create policy "owners manage sync tombstones" on public.sync_tombstones
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create index if not exists sync_tombstones_owner_deleted_idx
  on public.sync_tombstones (owner_id, deleted_at desc);

alter table public.classes add column if not exists sync_revision bigint not null default 0 check (sync_revision >= 0);
alter table public.classes add column if not exists sync_updated_at timestamptz not null default timezone('utc', now());
alter table public.classes add column if not exists sync_device_id text;
alter table public.students add column if not exists sync_revision bigint not null default 0 check (sync_revision >= 0);
alter table public.students add column if not exists sync_updated_at timestamptz not null default timezone('utc', now());
alter table public.students add column if not exists sync_device_id text;
alter table public.grades add column if not exists sync_revision bigint not null default 0 check (sync_revision >= 0);
alter table public.grades add column if not exists sync_updated_at timestamptz not null default timezone('utc', now());
alter table public.grades add column if not exists sync_device_id text;

create or replace function public.reject_stale_sync_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tombstone public.sync_tombstones;
begin
  select * into tombstone
    from public.sync_tombstones
   where owner_id = new.owner_id
     and entity_type = tg_argv[0]
     and entity_id = new.id::text;

  if found then
    if new.sync_revision <= tombstone.revision
       or new.sync_updated_at <= tombstone.deleted_at then
      return null;
    end if;
    delete from public.sync_tombstones
     where owner_id = tombstone.owner_id
       and entity_type = tombstone.entity_type
       and entity_id = tombstone.entity_id;
  end if;
  return new;
end;
$$;

drop trigger if exists classes_reject_stale_sync on public.classes;
create trigger classes_reject_stale_sync before insert or update on public.classes
  for each row execute function public.reject_stale_sync_row('class');
drop trigger if exists students_reject_stale_sync on public.students;
create trigger students_reject_stale_sync before insert or update on public.students
  for each row execute function public.reject_stale_sync_row('student');
drop trigger if exists grades_reject_stale_sync on public.grades;
create trigger grades_reject_stale_sync before insert or update on public.grades
  for each row execute function public.reject_stale_sync_row('grade');

revoke all on table public.sync_tombstones from anon;
revoke execute on function public.reject_stale_sync_row() from public, anon, authenticated;

truncate table public.sync_conflicts, public.app_settings, public.grades, public.students, public.classes, public.sync_tombstones cascade;
