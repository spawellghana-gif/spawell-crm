-- WhatsApp can identify a contact by username even when no phone number is
-- exposed. Keep phone and username as independent identifiers; require at
-- least one, and keep each active client's non-blank identifier unique.

alter table public.client
  add column if not exists whatsapp_username text not null default '';

alter table public.enquiry
  add column if not exists whatsapp_username text not null default '';

-- Multiple username-only clients legitimately have a blank phone, so the
-- unique phone index must ignore blanks.
drop index if exists public.client_phone_uniq;
create unique index client_phone_uniq
  on public.client (phone_e164)
  where archived_at is null and btrim(phone_e164) <> '';

create unique index if not exists client_whatsapp_username_uniq
  on public.client (lower(btrim(whatsapp_username)))
  where archived_at is null and btrim(whatsapp_username) <> '';

create index if not exists enquiry_whatsapp_username_idx
  on public.enquiry (lower(btrim(whatsapp_username)))
  where btrim(whatsapp_username) <> '';

alter table public.client
  drop constraint if exists client_contact_identifier_check;
alter table public.client
  add constraint client_contact_identifier_check
  check (btrim(phone_e164) <> '' or btrim(whatsapp_username) <> '');

alter table public.enquiry
  drop constraint if exists enquiry_contact_identifier_check;
alter table public.enquiry
  add constraint enquiry_contact_identifier_check
  check (btrim(phone_e164) <> '' or btrim(whatsapp_username) <> '');

create or replace view public.client_view
with (security_invoker = true) as
select
  c.id,
  c.full_name,
  c.phone_e164,
  c.whatsapp_e164,
  c.pref_contact,
  c.location_type,
  c.area,
  c.address,
  c.landmark,
  c.maps_link,
  c.pref_service_id,
  c.pref_therapist_id,
  c.therapist_gender_pref,
  c.source,
  c.first_campaign,
  c.tags,
  c.marketing_opt_in,
  c.consent_at,
  c.notes,
  c.created_at,
  c.archived_at,
  count(b.id) filter (where b.status = any (array['completed'::booking_status, 'paid'::booking_status])) as completed_bookings,
  count(b.id) filter (where b.status = any (array['cancelled_client'::booking_status, 'cancelled_business'::booking_status])) as cancellations,
  count(b.id) filter (where b.status = 'no_show'::booking_status) as no_shows,
  coalesce(sum(pay.net), 0::numeric) as lifetime_collected_pesewas,
  max(b.starts_at) filter (where b.status = any (array['completed'::booking_status, 'paid'::booking_status])) as last_visit_at,
  min(b.starts_at) as first_booking_at,
  c.whatsapp_username
from public.client c
left join public.booking b on b.client_id = c.id and b.archived_at is null
left join lateral (
  select sum(payment.amount_pesewas) as net
  from public.payment
  where payment.booking_id = b.id
) pay on true
group by c.id;

create or replace view public.enquiry_view
with (security_invoker = true) as
select
  e.id,
  e.ref,
  e.client_id,
  e.partner_id,
  e.full_name,
  e.phone_e164,
  e.whatsapp_e164,
  e.channel,
  e.source,
  e.campaign,
  e.ad_group,
  e.keyword,
  e.utm,
  e.service_id,
  e.duration_min,
  e.preferred_at,
  e.location_type,
  e.area,
  e.address,
  e.landmark,
  e.maps_link,
  e.guests,
  e.therapist_gender_pref,
  e.quote_pesewas,
  e.status,
  e.owner_id,
  e.follow_up_at,
  e.lost_reason,
  e.booking_id,
  e.notes,
  e.created_at,
  e.updated_at,
  e.archived_at,
  s.name as service_name,
  p.name as partner_name,
  u.full_name as owner_name,
  b.ref as booking_ref,
  e.whatsapp_username
from public.enquiry e
left join public.service s on s.id = e.service_id
left join public.partner p on p.id = e.partner_id
left join public.app_user u on u.id = e.owner_id
left join public.booking b on b.id = e.booking_id;

create or replace view public.booking_view
with (security_invoker = true) as
select
  b.id,
  b.ref,
  b.client_id,
  b.enquiry_id,
  b.partner_id,
  b.service_id,
  b.addons,
  b.duration_min,
  b.guests,
  b.concurrent,
  b.starts_at,
  b.ends_at,
  b.buffer_before_min,
  b.buffer_after_min,
  b.location_type,
  b.city,
  b.area,
  b.address,
  b.landmark,
  b.maps_link,
  b.hotel_name,
  b.room_no,
  b.base_pesewas,
  b.transport_pesewas,
  b.addons_pesewas,
  b.discount_pesewas,
  b.tax_pesewas,
  b.total_pesewas,
  b.status,
  b.payment_status,
  b.consent_confirmed,
  b.notes_internal,
  b.instructions_client,
  b.source,
  b.campaign,
  b.cancel_reason,
  b.cancel_fee_pesewas,
  b.created_by,
  b.created_at,
  b.updated_by,
  b.updated_at,
  b.archived_at,
  c.full_name as client_name,
  c.phone_e164 as client_phone,
  c.whatsapp_e164 as client_whatsapp,
  s.name as service_name,
  p.name as partner_name,
  coalesce(pay.net, 0::bigint) as paid_pesewas,
  greatest(b.total_pesewas - coalesce(pay.net, 0::bigint), 0::bigint) as balance_pesewas,
  th.names as therapist_names,
  th.ids as therapist_ids,
  c.whatsapp_username as client_whatsapp_username
from public.booking b
join public.client c on c.id = b.client_id
join public.service s on s.id = b.service_id
left join public.partner p on p.id = b.partner_id
left join lateral (
  select sum(payment.amount_pesewas) as net
  from public.payment
  where payment.booking_id = b.id
) pay on true
left join lateral (
  select array_agg(t.full_name order by t.full_name) as names,
         array_agg(t.id order by t.full_name) as ids
  from public.booking_therapist bt
  join public.therapist t on t.id = bt.therapist_id
  where bt.booking_id = b.id
) th on true;
