-- A booking's durable queue entry belongs in the same transaction as the
-- booking. No network calls, credentials or Google availability are involved.
create schema if not exists conversion_private;
revoke all on schema conversion_private from public, anon, authenticated;

alter table public.conversion_event
  add column google_processing_status text not null default 'unchecked'
    check (google_processing_status in ('unchecked','processing','success','failed','partial_success','unknown')),
  add column google_processing_checked_at timestamptz,
  add column google_processing_response jsonb,
  add column google_processing_error text not null default '';

alter table public.settings
  add column conversion_worker_last_run_at timestamptz,
  add column conversion_worker_last_result jsonb;

-- Owners already operate the manual uploader. Permit its append-only history;
-- officers still cannot upload, retry, or manufacture delivery records.
grant insert on public.conversion_attempt to authenticated;
create policy conversion_attempt_insert on public.conversion_attempt
  for insert to authenticated with check ((select public.is_owner()));

create function conversion_private.queue_booking_conversion(p_booking_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.booking%rowtype;
  phone text;
  eligible boolean;
  reason text;
begin
  select * into b from public.booking where id = p_booking_id;
  if not found then return; end if;

  if b.status::text in ('cancelled_client','cancelled_business','no_show') or b.archived_at is not null then
    update public.conversion_event set status = 'void', next_attempt_at = null
    where booking_id = b.id and status <> 'void';
    return;
  end if;
  if b.confirmed_at is null or b.status::text not in
    ('confirmed','therapist_assigned','en_route','arrived','in_service','completed','paid') then
    return;
  end if;

  select regexp_replace(trim(phone_e164), '[^+0-9]', '', 'g') into phone
  from public.client where id = b.client_id;
  if phone !~ '^\+[1-9][0-9]{7,14}$' then phone := ''; end if;
  eligible := b.gclid <> '' or b.gbraid <> '' or b.wbraid <> ''
    or (b.source = 'google_search_ads' and coalesce(phone, '') <> '');
  reason := case when eligible then '' when b.source = 'google_search_ads'
    then 'Google Ads lead but no phone or email to match on'
    else 'no advertising attribution on this booking' end;

  insert into public.conversion_event as ev
    (dedup_key, booking_id, client_id, event_name, gclid, gbraid, wbraid,
     phone_sha256, conversion_at, value_pesewas, currency, status, skip_reason, next_attempt_at)
  values ('SPAWELL-' || b.ref, b.id, b.client_id, 'confirmed_booking', b.gclid, b.gbraid, b.wbraid,
    case when coalesce(phone, '') = '' then '' else encode(sha256(convert_to(phone, 'UTF8')), 'hex') end,
    b.confirmed_at, b.total_pesewas, 'GHS', case when eligible then 'pending' else 'skipped' end,
    reason, case when eligible then now() end)
  on conflict (dedup_key) do update set
    status = case when ev.google_response->>'requestId' is not null then 'synced' else excluded.status end,
    revision = ev.revision + case when ev.status = 'void' then 1 else 0 end,
    gclid = case when ev.google_response->>'requestId' is not null then ev.gclid else excluded.gclid end,
    gbraid = case when ev.google_response->>'requestId' is not null then ev.gbraid else excluded.gbraid end,
    wbraid = case when ev.google_response->>'requestId' is not null then ev.wbraid else excluded.wbraid end,
    phone_sha256 = case when ev.google_response->>'requestId' is not null then ev.phone_sha256 else excluded.phone_sha256 end,
    value_pesewas = case when ev.google_response->>'requestId' is not null then ev.value_pesewas else excluded.value_pesewas end,
    skip_reason = excluded.skip_reason,
    next_attempt_at = case when ev.google_response->>'requestId' is null then excluded.next_attempt_at end,
    error_detail = ''
  where ev.status = 'void' or (ev.status = 'skipped' and excluded.status = 'pending');
end;
$$;
revoke all on function conversion_private.queue_booking_conversion(uuid) from public, anon, authenticated;

create function conversion_private.booking_conversion_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform conversion_private.queue_booking_conversion(new.id);
  return new;
end;
$$;
revoke all on function conversion_private.booking_conversion_trigger() from public, anon, authenticated;
create trigger booking_conversion_queue after insert or update on public.booking
  for each row execute function conversion_private.booking_conversion_trigger();

-- Bounded owner/service maintenance. Callers supply a booking ID, never an
-- arbitrary conversion payload. The helper derives everything from CRM rows.
create function public.queue_booking_conversion(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not ((select public.is_owner()) or coalesce(auth.role() = 'service_role', false)) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  perform conversion_private.queue_booking_conversion(p_booking_id);
  select jsonb_build_object('status', status, 'dedupKey', dedup_key,
    'note', case when status = 'synced' then 'Upload receipt retained' else 'Queue checked' end)
    into result from public.conversion_event where booking_id = p_booking_id;
  return result;
end;
$$;
revoke all on function public.queue_booking_conversion(uuid) from public, anon;
grant execute on function public.queue_booking_conversion(uuid) to authenticated, service_role;

-- Record the attempt and its result atomically, using the caller's existing
-- RLS permissions. A stale worker cannot overwrite a newer claim. Cancellation
-- during an upload retains the receipt without reviving the cancelled event.
create function public.finish_conversion_attempt(
  p_event_id uuid, p_claimed_at timestamptz, p_ok boolean,
  p_http_status integer, p_response jsonb, p_error text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare ev public.conversion_event%rowtype; n integer;
begin
  select * into ev from public.conversion_event where id = p_event_id
    and status in ('sending','void') and last_attempt_at = p_claimed_at for update;
  if not found then return false; end if;
  n := ev.attempts + 1;
  insert into public.conversion_attempt(conversion_id, attempt_no, ok, http_status, response, error_detail)
  values (ev.id, n, p_ok, p_http_status, p_response, left(coalesce(p_error, ''), 1000));
  update public.conversion_event set
    status = case when ev.status = 'void' then 'void' when p_ok then 'synced' when n < 6 then 'pending' else 'failed' end,
    attempts = n,
    next_attempt_at = case when not p_ok and ev.status <> 'void' and n < 6
      then now() + least(power(5, n) / 5, 600) * interval '1 minute' end,
    google_response = case when p_ok then p_response else ev.google_response end,
    google_processing_status = case when p_ok then 'unchecked' else ev.google_processing_status end,
    google_processing_checked_at = case when p_ok then null else ev.google_processing_checked_at end,
    google_processing_response = case when p_ok then null else ev.google_processing_response end,
    google_processing_error = case when p_ok then '' else ev.google_processing_error end,
    error_detail = case when p_ok then '' else left(coalesce(p_error, ''), 1000) end
  where id = ev.id;
  return true;
end;
$$;
revoke all on function public.finish_conversion_attempt(uuid,timestamptz,boolean,integer,jsonb,text) from public, anon;
grant execute on function public.finish_conversion_attempt(uuid,timestamptz,boolean,integer,jsonb,text) to authenticated, service_role;

-- Recover genuine historical confirmations; never invent confirmation times
-- or overwrite existing upload receipts. Re-running is idempotent.
do $$ declare b record; begin
  for b in select id from public.booking where confirmed_at is not null and archived_at is null
    and status::text in ('confirmed','therapist_assigned','en_route','arrived','in_service','completed','paid')
  loop perform conversion_private.queue_booking_conversion(b.id); end loop;
end $$;
