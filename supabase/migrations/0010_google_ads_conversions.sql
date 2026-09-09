-- SpaWell CRM — Google Ads confirmed-booking conversion tracking.
--
-- The business question this answers: which advertising produced a REAL
-- booking, not a click, not a WhatsApp tap, not a conversation. Google can
-- already see the first three. Only this database knows the fourth.
--
-- Entirely additive. Every column is nullable or defaulted, so existing
-- enquiries, clients and bookings keep working untouched and unattributed.
-- No table is dropped, no enum is altered, no status is renamed.
--
-- The status milestones the spec asks for already exist and are reused:
--   NEW LEAD         enquiry.status = 'new'
--   CONTACTED        enquiry.status = 'contacted'
--   QUALIFIED        enquiry.status = 'qualified'
--   BOOKING PENDING  booking.status = 'awaiting_confirmation'
--   BOOKING CONFIRMED booking.status = 'confirmed'   <-- the conversion
--   SERVICE COMPLETED booking.status = 'completed'
--   CANCELLED        booking.status in ('cancelled_client','cancelled_business')
--   NO SHOW          booking.status = 'no_show'

-- ============================================================ ad_click
-- First-party attribution, captured on the website before the visitor
-- disappears into WhatsApp.
--
-- The website posts the click identifiers here and gets back a short opaque
-- token. That token — and nothing else — is placed in the prefilled WhatsApp
-- message. No gclid, no phone number, no email ever travels in a public URL:
-- the token is meaningless to anyone who does not hold this table.
create table if not exists ad_click (
  id            uuid primary key default gen_random_uuid(),
  -- Short, human-typeable, unguessable enough for a value that grants nothing
  -- but the ability to claim one anonymous click record.
  token         text unique not null,
  gclid         text not null default '',
  gbraid        text not null default '',
  wbraid        text not null default '',
  utm_source    text not null default '',
  utm_medium    text not null default '',
  utm_campaign  text not null default '',
  utm_term      text not null default '',
  utm_content   text not null default '',
  landing_page  text not null default '',
  referrer      text not null default '',
  first_touch_at timestamptz not null default now(),
  claimed_by_enquiry_id uuid references enquiry(id) on delete set null,
  claimed_at    timestamptz,
  created_at    timestamptz not null default now()
);

comment on table ad_click is
  'Ad click captured on the website, retrievable by an opaque token carried through the WhatsApp handoff. Never put the identifiers themselves in a URL.';

create index if not exists ad_click_token_idx      on ad_click (token);
create index if not exists ad_click_unclaimed_idx  on ad_click (created_at desc) where claimed_by_enquiry_id is null;

-- ==================================================== enquiry attribution
-- First touch is written once and never overwritten: a customer who returns
-- through Instagram three weeks later has not stopped having come from the ad.
-- Latest touch is kept separately so both questions can be answered.
alter table enquiry add column if not exists ad_click_id      uuid references ad_click(id) on delete set null;
alter table enquiry add column if not exists gclid            text not null default '';
alter table enquiry add column if not exists gbraid           text not null default '';
alter table enquiry add column if not exists wbraid           text not null default '';
alter table enquiry add column if not exists landing_page     text not null default '';
alter table enquiry add column if not exists first_touch_at   timestamptz;
alter table enquiry add column if not exists first_touch_source text not null default '';
alter table enquiry add column if not exists last_touch_source  text not null default '';
alter table enquiry add column if not exists last_touch_at      timestamptz;
-- 'none' | 'google_ads' | 'other'. Set from evidence, never assumed.
alter table enquiry add column if not exists ad_attribution_status text not null default 'none';

comment on column enquiry.ad_attribution_status is
  'none = no advertising evidence; google_ads = a Google click identifier or a Google Ads source was captured; other = attributed to a non-Google channel. Never inferred from the absence of data.';

-- Client keeps first touch too, so a repeat customer's origin survives even
-- when the original enquiry is archived.
alter table client add column if not exists first_touch_at     timestamptz;
alter table client add column if not exists first_touch_source text not null default '';
alter table client add column if not exists first_gclid        text not null default '';

-- ==================================================== booking attribution
-- Copied from the enquiry when the booking is created, so the conversion has
-- what it needs even if the enquiry is later edited or archived.
alter table booking add column if not exists ad_click_id  uuid references ad_click(id) on delete set null;
alter table booking add column if not exists gclid        text not null default '';
alter table booking add column if not exists gbraid       text not null default '';
alter table booking add column if not exists wbraid       text not null default '';
alter table booking add column if not exists confirmed_at timestamptz;
alter table booking add column if not exists confirmed_by uuid references app_user(id) on delete set null;

-- ==================================================== conversion_event
-- One row per booking, for the life of the booking. Not one row per attempt,
-- and not one row per confirmation: a booking that is confirmed, cancelled and
-- confirmed again keeps the same row and the same transaction id, so Google
-- treats the resend as a restatement rather than a second sale.
create table if not exists conversion_event (
  id            uuid primary key default gen_random_uuid(),
  -- The idempotency key, and the transactionId sent to Google. Derived from
  -- the booking reference, which is immutable, rather than from a timestamp
  -- or a counter that a retry could change.
  dedup_key     text unique not null,
  booking_id    uuid not null references booking(id) on delete cascade,
  client_id     uuid references client(id) on delete set null,
  event_name    text not null default 'confirmed_booking',

  gclid         text not null default '',
  gbraid        text not null default '',
  wbraid        text not null default '',

  -- Hashed at creation, per Google's Enhanced Conversions spec. The raw values
  -- live on the client record where they belong; nothing here can be reversed
  -- and nothing here is written to a log.
  email_sha256  text not null default '',
  phone_sha256  text not null default '',

  conversion_at timestamptz not null,
  value_pesewas int not null default 0 check (value_pesewas >= 0),
  currency      text not null default 'GHS',

  -- pending  : queued, not yet sent
  -- sending  : claimed by a worker
  -- synced   : Google accepted it
  -- failed   : Google rejected it, or the transport failed, retries exhausted
  -- skipped  : deliberately not sent — no advertising evidence for this booking
  -- void     : the booking was cancelled after being reported
  status        text not null default 'pending'
                check (status in ('pending','sending','synced','failed','skipped','void')),
  skip_reason   text not null default '',

  attempts      int not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  -- Bumped when a cancelled booking is confirmed again. The transaction id
  -- stays the same on purpose; this only records that it happened.
  revision      int not null default 1,

  google_response jsonb,
  error_detail    text not null default '',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table conversion_event is
  'One confirmed-booking conversion per booking. dedup_key is both the local idempotency key and the transactionId sent to Google, so a resend restates rather than duplicates.';

create index if not exists conversion_due_idx on conversion_event (next_attempt_at)
  where status in ('pending','failed');
create index if not exists conversion_booking_idx on conversion_event (booking_id);

create trigger conversion_touch before update on conversion_event
  for each row execute function touch_updated_at();

-- Deliveries and failures, kept separately from the event so the event row
-- stays small and the history is never overwritten by the next attempt.
create table if not exists conversion_attempt (
  id            uuid primary key default gen_random_uuid(),
  conversion_id uuid not null references conversion_event(id) on delete cascade,
  attempt_no    int not null,
  ok            boolean not null,
  http_status   int,
  -- Response only. Never the request: the request carries hashed customer data.
  response      jsonb,
  error_detail  text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists conversion_attempt_idx on conversion_attempt (conversion_id, created_at desc);

-- ==================================================== settings
alter table settings add column if not exists google_ads_sync_enabled boolean not null default false;
alter table settings add column if not exists google_ads_customer_id  text not null default '';
alter table settings add column if not exists google_ads_conversion_action text not null default '';

comment on column settings.google_ads_sync_enabled is
  'Master switch. Off by default: the integration stays inert, and conversions queue as pending, until credentials are supplied and this is turned on.';

-- ==================================================== security
alter table ad_click           enable row level security;
alter table conversion_event   enable row level security;
alter table conversion_attempt enable row level security;

-- ad_click is written by the public website endpoint, which runs server-side
-- with the service key. Nothing signed in needs to write it; staff read it to
-- see where an enquiry came from.
drop policy if exists ad_click_read on ad_click;
create policy ad_click_read on ad_click for select using (is_staff());

-- Staff may claim the click for an enquiry they can read, but cannot rewrite
-- any captured advertising identifiers.
create policy ad_click_claim on ad_click for update
  using (is_staff() and claimed_by_enquiry_id is null)
  with check (is_staff() and exists (
    select 1 from enquiry e where e.id = claimed_by_enquiry_id and e.ad_click_id = ad_click.id
  ));

drop policy if exists conversion_read  on conversion_event;
drop policy if exists conversion_write on conversion_event;
create policy conversion_read  on conversion_event for select using (is_staff());
-- Only the owner may retry or void by hand; the worker uses the service key.
create policy conversion_write on conversion_event for all
  using (is_owner()) with check (is_owner());

drop policy if exists conversion_attempt_read on conversion_attempt;
create policy conversion_attempt_read on conversion_attempt for select using (is_owner());

revoke insert, update, delete on ad_click from anon, authenticated;
grant select on ad_click to authenticated;
grant update (claimed_by_enquiry_id, claimed_at) on ad_click to authenticated;
grant select, insert, update, delete on conversion_event to authenticated;
grant select on conversion_attempt to authenticated;

-- Conversions are money-adjacent and advertising-adjacent; both are worth an
-- audit trail. The existing append-only audit_log takes them.
create trigger audit_conversion after insert or update or delete on conversion_event
  for each row execute function audit_change();
