-- Run after the migration. All fixtures, trigger effects and audit entries are
-- rolled back; this test never invokes Google or commits a customer booking.
begin;
do $$
declare
  b public.booking%rowtype;
  ev public.conversion_event%rowtype;
  claim timestamptz := clock_timestamp();
  test_id uuid := gen_random_uuid();
begin
  select * into b from public.booking where confirmed_at is not null limit 1;
  if not found then raise exception 'A booking template is required for this integration test'; end if;
  b.id := test_id;
  b.ref := 'BKG-QUEUE-TEST-' || test_id;
  b.status := 'awaiting_confirmation';
  b.confirmed_at := null;
  b.archived_at := null;
  b.gclid := 'local-test-never-uploaded';
  b.gbraid := ''; b.wbraid := '';
  b.source := 'google_search_ads';
  insert into public.booking select (b).*;
  assert not exists(select 1 from public.conversion_event where booking_id = test_id), 'An unconfirmed booking was queued';

  update public.booking set status = 'confirmed', confirmed_at = now() where id = test_id;
  select * into strict ev from public.conversion_event where booking_id = test_id;
  assert ev.status = 'pending' and ev.dedup_key = 'SPAWELL-' || b.ref, 'Confirmation did not create the correct event';
  assert ev.value_pesewas = b.total_pesewas and ev.conversion_at is not null, 'Conversion values were not derived from the booking';
  update public.booking set status = 'confirmed' where id = test_id;
  assert (select count(*) from public.conversion_event where booking_id = test_id) = 1, 'Duplicate event created';

  update public.booking set status = 'no_show' where id = test_id;
  assert (select status from public.conversion_event where id = ev.id) = 'void', 'Cancellation was not voided';
  update public.booking set status = 'confirmed' where id = test_id;
  assert (select status from public.conversion_event where id = ev.id) = 'pending', 'Reconfirmation did not retain the queue';

  update public.conversion_event set status = 'sending', last_attempt_at = claim where id = ev.id;
  assert not public.finish_conversion_attempt(ev.id, claim - interval '1 second', true, 200, '{"requestId":"test"}', ''), 'A stale worker overwrote the claim';
  assert public.finish_conversion_attempt(ev.id, claim, true, 200, '{"requestId":"local-test-receipt"}', ''), 'Could not finish the claimed upload';
  assert (select count(*) from public.conversion_attempt where conversion_id = ev.id) = 1, 'Attempt history was not stored';
  assert (select status = 'synced' and google_processing_status = 'unchecked' from public.conversion_event where id = ev.id), 'Receipt was mistaken for processing success';
  assert not public.finish_conversion_attempt(ev.id, claim, true, 200, '{"requestId":"test"}', ''), 'An already finished claim was saved twice';

  update public.booking set status = 'no_show' where id = test_id;
  update public.booking set status = 'confirmed' where id = test_id;
  assert (select status = 'synced' and google_response->>'requestId' = 'local-test-receipt' from public.conversion_event where id = ev.id), 'Reconfirmation lost the upload receipt';

  b.id := gen_random_uuid(); b.ref := 'BKG-ORGANIC-TEST-' || b.id;
  b.status := 'confirmed'; b.confirmed_at := now(); b.source := 'google_organic'; b.gclid := '';
  insert into public.booking select (b).*;
  assert (select status from public.conversion_event where booking_id = b.id) = 'skipped', 'An organic booking was queued for Google Ads';
  assert not has_function_privilege('anon', 'public.queue_booking_conversion(uuid)', 'execute'), 'Anonymous queue access is enabled';
  assert not has_function_privilege('authenticated', 'conversion_private.queue_booking_conversion(uuid)', 'execute'), 'The private trigger helper is exposed';
end $$;
-- Exercise the actual owner and non-owner RLS paths with transaction-local
-- claims. These are database test contexts, not login sessions or credentials.
select set_config('request.jwt.claims', jsonb_build_object('sub',
  (select id from public.app_user where role = 'owner' limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare ev public.conversion_event%rowtype; claim timestamptz := clock_timestamp(); begin
  assert public.is_owner(), 'An owner test context is required';
  select * into strict ev from public.conversion_event where dedup_key like 'SPAWELL-BKG-QUEUE-TEST-%';
  perform public.queue_booking_conversion(ev.booking_id);
  update public.conversion_event set status = 'sending', last_attempt_at = claim where id = ev.id;
  assert public.finish_conversion_attempt(ev.id, claim, true, 200, '{"requestId":"owner-test-receipt"}', ''), 'Owner could not save an upload and attempt under RLS';
end $$;
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.queue_booking_conversion(gen_random_uuid());
    raise exception 'Non-owner was allowed to operate the queue';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.conversion_attempt(conversion_id, attempt_no, ok) values(gen_random_uuid(), 1, true);
    raise exception 'Non-owner was allowed to write upload history';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
