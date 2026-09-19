-- Mueen Al-Ostad database foundation.
-- This migration is intentionally imperative so it can be applied by Supabase CLI.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  school_name text,
  phone text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.app_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id)
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  level text,
  section text,
  weekly_hours smallint not null default 2 check (weekly_hours between 1 and 10),
  academic_year text,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, name, academic_year)
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  external_id text,
  full_name text not null check (length(btrim(full_name)) > 0),
  normalized_name text generated always as (
    lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g'))
  ) stored,
  number_in_list integer not null check (number_in_list > 0),
  reg_number text,
  registration_number text,
  is_repeater boolean not null default false,
  guardian_phone text,
  gender text check (gender in ('male', 'female', 'other', 'unspecified')),
  birth_date date,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, class_id, external_id),
  unique (owner_id, class_id, number_in_list)
);

create table public.grades (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  trimester smallint not null check (trimester between 1 and 3),
  continuous_eval numeric(5,2) check (continuous_eval between 0 and 20),
  behavior_score numeric(5,2) check (behavior_score between 0 and 5),
  attendance_score numeric(5,2) check (attendance_score between 0 and 5),
  notebook_score numeric(5,2) check (notebook_score between 0 and 5),
  participation_score numeric(5,2) check (participation_score between 0 and 5),
  quiz numeric(5,2) check (quiz between 0 and 20),
  exam numeric(5,2) check (exam between 0 and 20),
  calculated_average numeric(5,2) check (calculated_average between 0 and 20),
  estimation text,
  guidance text,
  remarks text,
  follow_up_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (student_id, trimester)
);

create or replace function public.validate_grade_relationships()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  student_class_id uuid;
  student_owner_id uuid;
  class_owner_id uuid;
begin
  select s.class_id, s.owner_id
    into student_class_id, student_owner_id
    from public.students as s
   where s.id = new.student_id;

  select c.owner_id
    into class_owner_id
    from public.classes as c
   where c.id = new.class_id;

  if student_class_id is distinct from new.class_id then
    raise exception 'grade class_id must match the student class_id';
  end if;

  if student_owner_id is distinct from new.owner_id
     or class_owner_id is distinct from new.owner_id then
    raise exception 'grade owner_id must match both student and class owners';
  end if;

  return new;
end;
$$;

create trigger grades_validate_relationships
before insert or update of owner_id, student_id, class_id
on public.grades
for each row execute function public.validate_grade_relationships();

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  session_date date not null,
  start_time time,
  end_time time,
  trimester smallint check (trimester between 1 and 3),
  topic text,
  teacher_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, class_id, session_date, start_time)
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'present' check (status in ('present', 'absent', 'late', 'excused')),
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (session_id, student_id)
);

create table public.session_behaviors (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  behavior text not null check (length(btrim(behavior)) > 0),
  rating smallint check (rating between 1 and 5),
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  room text,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (end_time > start_time),
  unique (owner_id, class_id, weekday, start_time)
);

create table public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  unit_key text not null,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, class_id, unit_key)
);

create table public.lesson_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  title text not null check (length(btrim(title)) > 0),
  unit_key text,
  planned_for date,
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'ready', 'completed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.custom_units (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  level text,
  title text not null check (length(btrim(title)) > 0),
  description text,
  sort_order integer not null default 0,
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, level, title)
);

create table public.file_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  bucket_id text not null default 'private-assets',
  path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, bucket_id, path)
);

create or replace function public.validate_owned_class()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  class_owner_id uuid;
begin
  if new.class_id is null then
    return new;
  end if;
  select owner_id into class_owner_id from public.classes where id = new.class_id;
  if class_owner_id is distinct from new.owner_id then
    raise exception 'related class must belong to the same owner';
  end if;
  return new;
end;
$$;

create trigger students_validate_class_owner
before insert or update of owner_id, class_id on public.students
for each row execute function public.validate_owned_class();

create trigger sessions_validate_class_owner
before insert or update of owner_id, class_id on public.sessions
for each row execute function public.validate_owned_class();

create trigger timetable_validate_class_owner
before insert or update of owner_id, class_id on public.timetable_slots
for each row execute function public.validate_owned_class();

create trigger progress_validate_class_owner
before insert or update of owner_id, class_id on public.lesson_progress
for each row execute function public.validate_owned_class();

create trigger lesson_plans_validate_class_owner
before insert or update of owner_id, class_id on public.lesson_plans
for each row execute function public.validate_owned_class();

create or replace function public.validate_session_relationships()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  session_owner_id uuid;
  session_class_id uuid;
  student_owner_id uuid;
  student_class_id uuid;
begin
  select owner_id, class_id into session_owner_id, session_class_id
  from public.sessions where id = new.session_id;
  select owner_id, class_id into student_owner_id, student_class_id
  from public.students where id = new.student_id;
  if session_owner_id is distinct from new.owner_id
     or student_owner_id is distinct from new.owner_id
     or student_class_id is distinct from session_class_id then
    raise exception 'session child records must match the session owner and class';
  end if;
  return new;
end;
$$;

create trigger attendance_validate_relationships
before insert or update of owner_id, session_id, student_id on public.attendance
for each row execute function public.validate_session_relationships();

create trigger behavior_validate_relationships
before insert or update of owner_id, session_id, student_id on public.session_behaviors
for each row execute function public.validate_session_relationships();

create index students_owner_id_idx on public.students (owner_id);
create index students_class_id_idx on public.students (class_id);
create index grades_owner_id_idx on public.grades (owner_id);
create index grades_student_id_idx on public.grades (student_id);
create index grades_class_id_idx on public.grades (class_id);
create index sessions_owner_id_idx on public.sessions (owner_id);
create index sessions_class_id_idx on public.sessions (class_id);
create index sessions_date_idx on public.sessions (owner_id, session_date);
create index attendance_owner_id_idx on public.attendance (owner_id);
create index attendance_session_id_idx on public.attendance (session_id);
create index attendance_student_id_idx on public.attendance (student_id);
create index session_behaviors_owner_id_idx on public.session_behaviors (owner_id);
create index session_behaviors_session_id_idx on public.session_behaviors (session_id);
create index timetable_slots_owner_id_idx on public.timetable_slots (owner_id);
create index timetable_slots_class_id_idx on public.timetable_slots (class_id);
create index lesson_progress_owner_id_idx on public.lesson_progress (owner_id);
create index lesson_progress_class_id_idx on public.lesson_progress (class_id);
create index lesson_plans_owner_id_idx on public.lesson_plans (owner_id);
create index lesson_plans_class_id_idx on public.lesson_plans (class_id);
create index custom_units_owner_id_idx on public.custom_units (owner_id);
create index file_assets_owner_id_idx on public.file_assets (owner_id);

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user_profile();

revoke execute on function public.handle_new_user_profile() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'app_settings', 'classes', 'students', 'grades', 'sessions',
    'attendance', 'session_behaviors', 'timetable_slots', 'lesson_progress',
    'lesson_plans', 'custom_units', 'file_assets'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', table_name || '_updated_at', table_name);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.grades enable row level security;
alter table public.sessions enable row level security;
alter table public.attendance enable row level security;
alter table public.session_behaviors enable row level security;
alter table public.timetable_slots enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.lesson_plans enable row level security;
alter table public.custom_units enable row level security;
alter table public.file_assets enable row level security;

create policy "profiles are owned by the signed-in user" on public.profiles
  for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_settings', 'classes', 'students', 'grades', 'sessions',
    'attendance', 'session_behaviors', 'timetable_slots', 'lesson_progress',
    'lesson_plans', 'custom_units', 'file_assets'
  ] loop
    execute format('create policy %I on public.%I for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', table_name || '_owner_access', table_name);
  end loop;
end $$;

insert into storage.buckets (id, name, public)
values ('private-assets', 'private-assets', false)
on conflict (id) do update set public = excluded.public;

create policy "private assets are readable by owner" on storage.objects
  for select to authenticated
  using (bucket_id = 'private-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "private assets are uploadable by owner" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'private-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "private assets are editable by owner" on storage.objects
  for update to authenticated
  using (bucket_id = 'private-assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'private-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "private assets are removable by owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'private-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);