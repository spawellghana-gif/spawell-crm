-- SpaWell CRM — triggers, derived values and the availability check.
-- Anything the numbers depend on lives here rather than in the web app, so a
-- second client (a phone app, an automation) cannot get it wrong.

-- ------------------------------------------------------- new staff member
-- A row in auth.users becomes a row in app_user. The first person to sign up
-- is the owner; everyone after that starts as a booking officer and the owner
-- promotes them in Settings.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select count(*) = 0 into first_user from app_user;
  insert into app_user (id, full_name, role, phone_e164)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when first_user then 'owner'::app_role else 'officer'::app_role end,
    new.raw_user_meta_data->>'phone'
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------- updated_at
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger enquiry_touch before update on enquiry
  for each row execute function touch_updated_at();
create trigger booking_touch before update on booking
  for each row execute function touch_updated_at();

-- ------------------------------------------------------- booking totals
-- total = base + transport + addons - discount + tax, never negative.
-- Recomputed on every write so a client cannot post an inconsistent total.
-- SECURITY DEFINER because it reads auth.uid(): a trigger running as the
-- caller cannot rely on every database role having USAGE on the auth schema.
create or replace function booking_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
declare pre int;
begin
  new.addons_pesewas := coalesce((
    select sum((a->>'price_pesewas')::int) from jsonb_array_elements(new.addons) a
  ), 0);
  pre := new.base_pesewas + new.transport_pesewas + new.addons_pesewas - new.discount_pesewas;
  if pre < 0 then pre := 0; end if;
  new.total_pesewas := pre + coalesce(new.tax_pesewas, 0);
  new.updated_by := coalesce(new.updated_by, auth.uid());
  return new;
end $$;

create trigger booking_recalc_trg before insert or update on booking
  for each row execute function booking_recalc();

-- ------------------------------------------------------- payment status
-- Payment status is derived from the payment rows, never set by hand.
create or replace function booking_sync_payment_status(b uuid) returns void
language plpgsql security definer set search_path = public as $$
declare net int; tot int; has_refund boolean;
begin
  select coalesce(sum(amount_pesewas),0), bool_or(kind = 'refund')
    into net, has_refund from payment where booking_id = b;
  select total_pesewas into tot from booking where id = b;

  update booking set
    payment_status = case
      when coalesce(has_refund,false) and net <= 0 then 'refunded'::payment_status
      when net <= 0 then 'unpaid'::payment_status
      when net >= tot then 'paid'::payment_status
      else 'part_paid'::payment_status end,
    -- a completed booking that is now settled moves itself to paid
    status = case
      when status = 'completed' and net >= tot and tot > 0 then 'paid'::booking_status
      else status end
  where id = b;
end $$;

create or replace function payment_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform booking_sync_payment_status(coalesce(new.booking_id, old.booking_id));
  return coalesce(new, old);
end $$;

create trigger payment_sync_trg after insert or update or delete on payment
  for each row execute function payment_after_change();

-- ------------------------------------------------------- therapist guard
-- A therapist may move their own job through its operational statuses and add
-- notes. They may not change who it is for, when it is, or what it costs.
create or replace function booking_therapist_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Constrain therapists only. A caller with no user context is a trusted
  -- server-side connection (the service-role key, a migration, a scheduled
  -- job); gating on `is_staff()` instead would fail those closed and break
  -- every backend write.
  if not is_therapist() then return new; end if;

  if new.client_id      is distinct from old.client_id
  or new.service_id     is distinct from old.service_id
  or new.starts_at      is distinct from old.starts_at
  or new.ends_at        is distinct from old.ends_at
  or new.total_pesewas  is distinct from old.total_pesewas
  or new.base_pesewas   is distinct from old.base_pesewas
  or new.discount_pesewas is distinct from old.discount_pesewas
  or new.partner_id     is distinct from old.partner_id then
    raise exception 'A therapist can update the status and notes of their own booking, not its client, time or price'
      using errcode = 'check_violation';
  end if;

  if new.status not in ('en_route','arrived','in_service','completed',
                        'therapist_assigned','confirmed','no_show') then
    raise exception 'A therapist cannot set the status %', new.status
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger booking_therapist_guard_trg before update on booking
  for each row execute function booking_therapist_guard();

-- ------------------------------------------------------- availability
-- Does this therapist clash with anything, counting travel buffers?
-- Returns the clashing bookings; empty means clear.
create or replace function booking_conflicts(
  p_therapist uuid, p_starts timestamptz, p_ends timestamptz,
  p_buffer_before int default 20, p_buffer_after int default 20,
  p_ignore_booking uuid default null
) returns table (booking_id uuid, ref text, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.ref, b.starts_at, b.ends_at
  from booking b
  join booking_therapist bt on bt.booking_id = b.id
  where bt.therapist_id = p_therapist
    and b.archived_at is null
    and b.status not in ('cancelled_client','cancelled_business','no_show')
    and (p_ignore_booking is null or b.id <> p_ignore_booking)
    -- overlap test, each side widened by its own travel buffer
    and (p_starts - make_interval(mins => p_buffer_before))
        < (b.ends_at + make_interval(mins => b.buffer_after_min))
    and (b.starts_at - make_interval(mins => b.buffer_before_min))
        < (p_ends + make_interval(mins => p_buffer_after))
$$;

-- Everything that makes a therapist unavailable, in one call: inactive, not a
-- working day, time off, outside hours, daily maximum reached, or a clash.
create or replace function therapist_availability(
  p_therapist uuid, p_starts timestamptz, p_ends timestamptz,
  p_buffer_before int default 20, p_buffer_after int default 20,
  p_ignore_booking uuid default null
) returns table (available boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
declare t therapist%rowtype; tz text; local_start timestamp; local_end timestamp; n int;
begin
  select * into t from therapist where id = p_therapist;
  if not found then return query select false, 'Unknown therapist'; return; end if;
  if not t.active or t.archived_at is not null then
    return query select false, 'Inactive'; return; end if;

  select timezone into tz from settings where id;
  tz := coalesce(tz, 'Africa/Accra');
  local_start := p_starts at time zone tz;
  local_end   := p_ends   at time zone tz;

  if not (extract(dow from local_start)::int = any (t.work_days)) then
    return query select false, 'Not working that day'; return; end if;

  if exists (select 1 from therapist_time_off o
             where o.therapist_id = p_therapist and o.day = local_start::date) then
    return query select false, 'Time off'; return; end if;

  if local_start::time < t.work_start or local_end::time > t.work_end then
    return query select false,
      'Outside ' || to_char(t.work_start,'HH24:MI') || '–' || to_char(t.work_end,'HH24:MI');
    return; end if;

  if exists (select 1 from booking_conflicts(p_therapist, p_starts, p_ends,
                                             p_buffer_before, p_buffer_after, p_ignore_booking)) then
    return query select false, 'Clashes with another booking'; return; end if;

  select count(*) into n from booking b
    join booking_therapist bt on bt.booking_id = b.id
   where bt.therapist_id = p_therapist
     and b.archived_at is null
     and b.status not in ('cancelled_client','cancelled_business','no_show')
     and (b.starts_at at time zone tz)::date = local_start::date
     and (p_ignore_booking is null or b.id <> p_ignore_booking);
  if n >= t.max_daily then
    return query select false, 'Daily maximum reached'; return; end if;

  return query select true, 'Available';
end $$;

-- ------------------------------------------------------- audit log
-- Append-only. Runs as definer because audit_log has no insert policy:
-- nothing but these triggers can write to it.
create or replace function audit_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a_name text; a_role app_role; rec_id text;
begin
  select full_name, role into a_name, a_role from app_user where id = auth.uid();
  rec_id := coalesce(
    case when tg_op = 'DELETE' then (to_jsonb(old)->>'ref') else (to_jsonb(new)->>'ref') end,
    case when tg_op = 'DELETE' then (to_jsonb(old)->>'id')  else (to_jsonb(new)->>'id')  end
  );

  insert into audit_log (actor_id, actor_name, actor_role, action, record_type, record_id, before, after)
  values (
    auth.uid(), a_name, a_role, lower(tg_op), tg_table_name, rec_id,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_enquiry  after insert or update or delete on enquiry
  for each row execute function audit_change();
create trigger audit_booking  after insert or update or delete on booking
  for each row execute function audit_change();
create trigger audit_payment  after insert or update or delete on payment
  for each row execute function audit_change();
create trigger audit_expense  after insert or update or delete on expense
  for each row execute function audit_change();
create trigger audit_client   after insert or update or delete on client
  for each row execute function audit_change();
create trigger audit_partner  after insert or update or delete on partner
  for each row execute function audit_change();
create trigger audit_therapist after insert or update or delete on therapist
  for each row execute function audit_change();
create trigger audit_pay      after insert or update or delete on therapist_pay
  for each row execute function audit_change();
create trigger audit_settings after update on settings
  for each row execute function audit_change();
create trigger audit_app_user after insert or update or delete on app_user
  for each row execute function audit_change();
