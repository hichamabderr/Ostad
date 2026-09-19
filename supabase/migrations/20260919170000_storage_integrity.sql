-- Keep memorandum metadata aligned with the private Storage namespace.
alter table public.memoranda_files
  drop constraint if exists memoranda_files_owner_path_check;

alter table public.memoranda_files
  add constraint memoranda_files_owner_path_check
  check (
    is_bundled
    or storage_path like ('users/' || owner_id::text || '/%')
  );

-- A teacher has one active override per curriculum unit. Historical rows may
-- remain soft-deleted, but the active lookup must be deterministic.
with ranked as (
  select
    id,
    row_number() over (
      partition by owner_id, unit_id
      order by updated_at desc, created_at desc, id desc
    ) as row_number
  from public.memoranda_files
  where is_bundled = false and deleted_at is null
)
update public.memoranda_files as files
set deleted_at = timezone('utc', now())
from ranked
where files.id = ranked.id
  and ranked.row_number > 1;

create unique index if not exists memoranda_files_one_active_override_idx
  on public.memoranda_files (owner_id, unit_id)
  where is_bundled = false and deleted_at is null;

revoke execute on function public.reset_workspace() from anon;
