create or replace function public.import_roster_batch(
  p_classes jsonb,
  p_students jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  wid uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select id into wid from public.workspaces where owner_id = auth.uid();
  if wid is null then
    raise exception 'Workspace unavailable';
  end if;

  if (
    select count(*) from (
      select c.id
      from jsonb_to_recordset(coalesce(p_classes, '[]'::jsonb))
        as c(id uuid, name text, level text, stream text)
      group by c.id
      having count(*) > 1
    ) duplicate_classes
  ) > 0 then
    raise exception 'Duplicate class identifiers in roster import payload';
  end if;

  if (
    select count(*) from (
      select s.id
      from jsonb_to_recordset(coalesce(p_students, '[]'::jsonb))
        as s(id uuid, class_id uuid, number_in_list integer, full_name text)
      group by s.id
      having count(*) > 1
    ) duplicate_students
  ) > 0 then
    raise exception 'Duplicate student identifiers in roster import payload';
  end if;

  insert into public.classes (
    id, workspace_id, owner_id, name, level, section, weekly_hours, updated_by
  )
  select
    c.id, wid, auth.uid(), btrim(c.name), c.level, nullif(c.stream, ''),
    case when c.level = '1AS_SCIENCE' then 1 else 2 end, auth.uid()
  from jsonb_to_recordset(coalesce(p_classes, '[]'::jsonb))
    as c(id uuid, name text, level text, stream text)
  where c.name is not null and btrim(c.name) <> ''
  on conflict (workspace_id, id) do update set
    name = excluded.name,
    level = excluded.level,
    section = excluded.section,
    weekly_hours = excluded.weekly_hours,
    updated_by = auth.uid();

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_students, '[]'::jsonb))
      as s(id uuid, class_id uuid, number_in_list integer, full_name text)
    left join public.classes c
      on c.workspace_id = wid and c.id = s.class_id and c.owner_id = auth.uid()
    where s.id is null
       or s.class_id is null
       or c.id is null
       or s.full_name is null
       or btrim(s.full_name) = ''
       or s.number_in_list is null
       or s.number_in_list < 1
  ) then
    raise exception 'Invalid roster import payload';
  end if;

  insert into public.students (
    id, workspace_id, owner_id, class_id, full_name, number_in_list,
    reg_number, registration_number, gender, birth_date, is_repeater,
    guardian_phone, notes, updated_by
  )
  select
    s.id, wid, auth.uid(), s.class_id, btrim(s.full_name), s.number_in_list,
    nullif(s.reg_number, ''), nullif(s.registration_number, ''),
    case when s.gender = 'M' then 'male' when s.gender = 'F' then 'female' else null end,
    nullif(s.birth_date, '')::date, coalesce(s.is_repeater, false),
    nullif(s.guardian_phone, ''), nullif(s.notes, ''), auth.uid()
  from jsonb_to_recordset(coalesce(p_students, '[]'::jsonb))
    as s(
      id uuid, class_id uuid, number_in_list integer, full_name text,
      reg_number text, registration_number text, gender text, birth_date text,
      is_repeater boolean, guardian_phone text, notes text
    )
  on conflict (workspace_id, id) do update set
    class_id = excluded.class_id,
    full_name = excluded.full_name,
    number_in_list = excluded.number_in_list,
    reg_number = excluded.reg_number,
    registration_number = excluded.registration_number,
    gender = excluded.gender,
    birth_date = excluded.birth_date,
    is_repeater = excluded.is_repeater,
    guardian_phone = excluded.guardian_phone,
    notes = excluded.notes,
    updated_by = auth.uid();
end
$$;

revoke execute on function public.import_roster_batch(jsonb, jsonb) from public, anon;
grant execute on function public.import_roster_batch(jsonb, jsonb) to authenticated;
