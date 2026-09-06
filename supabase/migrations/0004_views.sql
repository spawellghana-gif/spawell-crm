-- SpaWell CRM — reporting views.
-- security_invoker = on so every view is filtered by the caller's RLS: a
-- therapist selecting from booking_view sees only their own rows, not the
-- whole business. Without this, a view would run as its owner and quietly
-- become a hole straight through the policies in 0002.

create or replace view booking_view with (security_invoker = on) as
select
  b.*,
  c.full_name      as client_name,
  c.phone_e164     as client_phone,
  c.whatsapp_e164  as client_whatsapp,
  s.name           as service_name,
  p.name           as partner_name,
  coalesce(pay.net, 0)                          as paid_pesewas,
  greatest(b.total_pesewas - coalesce(pay.net,0), 0) as balance_pesewas,
  th.names         as therapist_names,
  th.ids           as therapist_ids
from booking b
join client c  on c.id = b.client_id
join service s on s.id = b.service_id
left join partner p on p.id = b.partner_id
left join lateral (
  select sum(amount_pesewas) as net from payment where booking_id = b.id
) pay on true
left join lateral (
  select array_agg(t.full_name order by t.full_name) as names,
         array_agg(t.id order by t.full_name)        as ids
  from booking_therapist bt join therapist t on t.id = bt.therapist_id
  where bt.booking_id = b.id
) th on true;

create or replace view enquiry_view with (security_invoker = on) as
select
  e.*,
  s.name as service_name,
  p.name as partner_name,
  u.full_name as owner_name,
  b.ref  as booking_ref
from enquiry e
left join service s on s.id = e.service_id
left join partner p on p.id = e.partner_id
left join app_user u on u.id = e.owner_id
left join booking b on b.id = e.booking_id;

-- What each partner has earned and what is still owed.
create or replace view partner_ledger with (security_invoker = on) as
select
  p.id,
  p.name,
  p.type,
  p.status,
  p.commission_pct,
  count(distinct e.id) filter (where e.archived_at is null)              as enquiries,
  count(distinct b.id) filter (where b.archived_at is null
        and b.status not in ('cancelled_client','cancelled_business'))    as bookings,
  coalesce(sum(pay.net), 0)                                              as collected_pesewas,
  round(coalesce(sum(pay.net),0) * p.commission_pct / 100)::int          as commission_earned_pesewas,
  coalesce(px.paid_out, 0)                                               as paid_out_pesewas,
  greatest(round(coalesce(sum(pay.net),0) * p.commission_pct / 100)::int
           - coalesce(px.paid_out,0), 0)                                 as owed_pesewas
from partner p
left join enquiry e on e.partner_id = p.id
left join booking b on b.partner_id = p.id
left join lateral (
  select sum(amount_pesewas) as net from payment where booking_id = b.id
) pay on true
left join lateral (
  select sum(amount_pesewas) as paid_out from expense
  where partner_id = p.id and category = 'partner_commission'
) px on true
group by p.id, p.name, p.type, p.status, p.commission_pct, px.paid_out;

-- Client lifetime figures for the client list and profile.
create or replace view client_view with (security_invoker = on) as
select
  c.*,
  count(b.id) filter (where b.status in ('completed','paid'))        as completed_bookings,
  count(b.id) filter (where b.status in ('cancelled_client','cancelled_business')) as cancellations,
  count(b.id) filter (where b.status = 'no_show')                    as no_shows,
  coalesce(sum(pay.net), 0)                                          as lifetime_collected_pesewas,
  max(b.starts_at) filter (where b.status in ('completed','paid'))   as last_visit_at,
  min(b.starts_at)                                                   as first_booking_at
from client c
left join booking b on b.client_id = c.id and b.archived_at is null
left join lateral (
  select sum(amount_pesewas) as net from payment where booking_id = b.id
) pay on true
group by c.id;

-- Dashboard numbers for a date window, computed once in the database.
-- Every definition matches the tooltips in the preview.
create or replace function dashboard_metrics(p_from date, p_to date)
returns table (
  enquiries int, enquiries_valid int, converted int, bookings_created int,
  confirmed int, completed int, cancelled int, no_shows int,
  collected_pesewas bigint, booked_value_pesewas bigint, outstanding_pesewas bigint,
  spend_pesewas bigint
)
language sql stable security invoker set search_path = public as $$
with tz as (select coalesce((select timezone from settings where id), 'Africa/Accra') as z),
d as (select p_from as f, p_to as t)
select
  (select count(*)::int from enquiry e, tz, d
     where e.archived_at is null and (e.created_at at time zone tz.z)::date between d.f and d.t),
  (select count(*)::int from enquiry e, tz, d
     where e.archived_at is null and e.status <> 'spam'
       and (e.created_at at time zone tz.z)::date between d.f and d.t),
  (select count(*)::int from enquiry e, tz, d
     where e.archived_at is null and e.status = 'booked'
       and (e.created_at at time zone tz.z)::date between d.f and d.t),
  (select count(*)::int from booking b, tz, d
     where b.archived_at is null and (b.created_at at time zone tz.z)::date between d.f and d.t),
  (select count(*)::int from booking b, tz, d
     where b.archived_at is null
       and b.status in ('confirmed','therapist_assigned','en_route','arrived','in_service','completed','paid')
       and (b.created_at at time zone tz.z)::date between d.f and d.t),
  (select count(*)::int from booking b, tz, d
     where b.archived_at is null and b.status in ('completed','paid')
       and (b.starts_at at time zone tz.z)::date between d.f and d.t),
  (select count(*)::int from booking b, tz, d
     where b.archived_at is null and b.status in ('cancelled_client','cancelled_business')
       and (b.starts_at at time zone tz.z)::date between d.f and d.t),
  (select count(*)::int from booking b, tz, d
     where b.archived_at is null and b.status = 'no_show'
       and (b.starts_at at time zone tz.z)::date between d.f and d.t),
  (select coalesce(sum(p.amount_pesewas),0)::bigint from payment p, tz, d
     where (p.received_at at time zone tz.z)::date between d.f and d.t),
  (select coalesce(sum(b.total_pesewas),0)::bigint from booking b, tz, d
     where b.archived_at is null and b.status not in ('cancelled_client','cancelled_business')
       and (b.created_at at time zone tz.z)::date between d.f and d.t),
  (select coalesce(sum(greatest(b.total_pesewas - coalesce((
        select sum(amount_pesewas) from payment where booking_id = b.id),0),0)),0)::bigint
     from booking b
     where b.archived_at is null
       and b.status in ('confirmed','therapist_assigned','en_route','arrived','in_service','completed')),
  (select coalesce(sum(m.spend_pesewas),0)::bigint from marketing_daily m, d
     where m.day between d.f and d.t)
$$;

-- Grants for the objects created in this file. The blanket grant in 0002 ran
-- before these views existed, so without this every select on a view fails
-- with "permission denied" even though the underlying policies would allow it.
grant select on booking_view, enquiry_view, partner_ledger, client_view to authenticated;
grant execute on function dashboard_metrics(date, date) to authenticated;
grant execute on function therapist_availability(uuid, timestamptz, timestamptz, int, int, uuid) to authenticated;
grant execute on function booking_conflicts(uuid, timestamptz, timestamptz, int, int, uuid) to authenticated;
