create or replace function public.reject_stale_sync_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tombstone public.sync_tombstones;
  stale boolean := false;
  remote_revision bigint := 0;
  remote_device text;
begin
  if tg_op = 'UPDATE' and (
    new.sync_revision < old.sync_revision
    or (new.sync_revision = old.sync_revision and new.sync_updated_at < old.sync_updated_at)
  ) then
    stale := true;
    remote_revision := old.sync_revision;
    remote_device := old.sync_device_id;
  else
    select * into tombstone
      from public.sync_tombstones
     where owner_id = new.owner_id
       and entity_type = tg_argv[0]
       and entity_id = new.id::text;

    if found and (
      new.sync_revision <= tombstone.revision
      or new.sync_updated_at <= tombstone.deleted_at
    ) then
      stale := true;
      remote_revision := tombstone.revision;
      remote_device := tombstone.device_id;
    elsif found then
      delete from public.sync_tombstones
       where owner_id = tombstone.owner_id
         and entity_type = tombstone.entity_type
         and entity_id = tombstone.entity_id;
    end if;
  end if;

  if stale then
    insert into public.sync_conflicts (
      owner_id, entity_type, entity_id, local_revision, remote_revision,
      local_device_id, remote_device_id, resolution
    ) values (
      new.owner_id, tg_argv[0], new.id::text, new.sync_revision, remote_revision,
      new.sync_device_id, remote_device, 'last-write-wins'
    );
    return null;
  end if;
  return new;
end;
$$;

revoke execute on function public.reject_stale_sync_row() from public, anon, authenticated;
