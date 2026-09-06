-- SpaWell CRM — schema
-- Postgres / Supabase. Currency GHS, timezone Africa/Accra.
-- Money is stored in pesewas (integer) to avoid float drift: 45000 = GHS 450.00

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ------------------------------------------------------- human-readable refs
-- ENQ-1001 / BKG-2001 / PAY-3001, the ids staff say out loud on the phone.
create sequence enquiry_ref_seq start 1001;
create sequence booking_ref_seq start 2001;
create sequence payment_ref_seq start 3001;

-- ---------------------------------------------------------------- enums
create type app_role          as enum ('owner','officer','therapist');
create type enquiry_status    as enum ('new','contacted','qualified','quoted','follow_up','booked','lost','spam');
create type booking_status    as enum ('draft','awaiting_confirmation','confirmed','therapist_assigned','en_route','arrived','in_service','completed','paid','cancelled_client','cancelled_business','no_show','rescheduled','refunded');
create type payment_status    as enum ('unpaid','part_paid','paid','refunded');
create type payment_kind      as enum ('deposit','balance','refund');
create type location_type     as enum ('home','hotel');
create type partner_type      as enum ('hotel','corporate','estate_agency','individual_referrer','agency','other');
create type partner_status    as enum ('active','in_discussion','paused','ended');
create type task_status       as enum ('open','done');
create type task_priority     as enum ('urgent','high','normal','low');
create type gender_pref       as enum ('none','female','male');

-- ---------------------------------------------------------------- people
-- One row per signed-in staff member, keyed to Supabase Auth.
create table app_user (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  role          app_role not null default 'officer',
  phone_e164    text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table therapist (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references app_user(id) on delete set null,
  full_name     text not null,
  phone_e164    text not null,
  gender        text not null check (gender in ('female','male')),
  city          text not null default 'Accra',
  base_area     text not null,
  active        boolean not null default true,
  work_days     int[] not null default '{1,2,3,4,5,6}',   -- 0=Sun .. 6=Sat
  work_start    time not null default '09:00',
  work_end      time not null default '20:00',
  max_daily     int  not null default 4 check (max_daily > 0),
  rating        numeric(2,1) check (rating between 0 and 5),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);

-- Therapist pay lives in its OWN table, not a column on `therapist`.
-- Row Level Security is per-row, not per-column: if commission sat on the
-- therapist row, any staff member who can read the roster to assign a booking
-- could read everyone's pay. A separate owner-only table makes "a therapist
-- must never see another therapist's pay" enforceable in the database rather
-- than by hiding a column in the interface.
create table therapist_pay (
  therapist_id   uuid primary key references therapist(id) on delete cascade,
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  hourly_pesewas int not null default 0 check (hourly_pesewas >= 0),
  notes          text not null default '',
  updated_at     timestamptz not null default now()
);

create table therapist_time_off (
  id            uuid primary key default gen_random_uuid(),
  therapist_id  uuid not null references therapist(id) on delete cascade,
  day           date not null,
  reason        text,
  unique (therapist_id, day)
);

-- ---------------------------------------------------------------- catalogue
create table service (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  active        boolean not null default true,
  buffer_min    int not null default 15 check (buffer_min >= 0),
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create table service_option (
  id            uuid primary key default gen_random_uuid(),
  service_id    uuid not null references service(id) on delete cascade,
  duration_min  int not null check (duration_min > 0),
  price_pesewas int not null check (price_pesewas >= 0),
  unique (service_id, duration_min)
);

create table service_addon (
  id            uuid primary key default gen_random_uuid(),
  service_id    uuid not null references service(id) on delete cascade,
  name          text not null,
  price_pesewas int not null check (price_pesewas >= 0),
  unique (service_id, name)
);

create table therapist_service (
  therapist_id  uuid not null references therapist(id) on delete cascade,
  service_id    uuid not null references service(id) on delete cascade,
  primary key (therapist_id, service_id)
);

create table zone (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  transport_fee_pesewas int not null default 0 check (transport_fee_pesewas >= 0)
);

-- ---------------------------------------------------------------- partners
create table partner (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          partner_type not null default 'hotel',
  status        partner_status not null default 'in_discussion',
  city          text not null default 'Accra',
  area          text not null default '',
  address       text not null default '',
  contact_name  text not null default '',
  contact_role  text not null default '',
  phone_e164    text not null default '',
  whatsapp_e164 text not null default '',
  email         citext,
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  partner_since date,
  payment_terms text not null default '',
  payout_method text not null default '',
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create table partner_event (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references partner(id) on delete cascade,
  type          text not null,
  body          text not null,
  actor_id      uuid references app_user(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- clients
create table client (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  phone_e164    text not null,
  whatsapp_e164 text not null default '',
  pref_contact  text not null default 'WhatsApp',
  location_type location_type not null default 'home',
  area          text not null default '',
  address       text not null default '',
  landmark      text not null default '',
  maps_link     text not null default '',
  pref_service_id   uuid references service(id) on delete set null,
  pref_therapist_id uuid references therapist(id) on delete set null,
  therapist_gender_pref gender_pref not null default 'none',
  source        text not null default 'direct_unknown',
  first_campaign text not null default '',
  tags          text[] not null default '{}',
  marketing_opt_in boolean not null default false,
  consent_at    timestamptz,
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);
-- One client per phone number: the duplicate check the preview does in the UI,
-- enforced here so two operators cannot create the same person twice.
create unique index client_phone_uniq on client (phone_e164) where archived_at is null;

-- ---------------------------------------------------------------- enquiries
create table enquiry (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique not null default 'ENQ-' || to_char(nextval('enquiry_ref_seq'), 'FM0000'),
  client_id     uuid references client(id) on delete set null,
  partner_id    uuid references partner(id) on delete set null,
  full_name     text not null,
  phone_e164    text not null,
  whatsapp_e164 text not null default '',
  channel       text not null default 'whatsapp',
  source        text not null default 'direct_unknown',
  campaign      text not null default '',
  ad_group      text not null default '',
  keyword       text not null default '',
  utm           jsonb not null default '{}'::jsonb,
  service_id    uuid references service(id) on delete set null,
  duration_min  int,
  preferred_at  timestamptz,
  location_type location_type not null default 'home',
  area          text not null default '',
  address       text not null default '',
  landmark      text not null default '',
  maps_link     text not null default '',
  guests        int not null default 1 check (guests > 0),
  therapist_gender_pref gender_pref not null default 'none',
  quote_pesewas int not null default 0 check (quote_pesewas >= 0),
  status        enquiry_status not null default 'new',
  owner_id      uuid references app_user(id) on delete set null,
  follow_up_at  timestamptz,
  lost_reason   text,
  booking_id    uuid,
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  -- a lost enquiry must say why
  constraint enquiry_lost_needs_reason
    check (status <> 'lost' or (lost_reason is not null and lost_reason <> ''))
);
create index enquiry_status_idx  on enquiry (status) where archived_at is null;
create index enquiry_created_idx on enquiry (created_at desc);
create index enquiry_phone_idx   on enquiry (phone_e164);
create index enquiry_partner_idx on enquiry (partner_id) where partner_id is not null;

create table enquiry_event (
  id            uuid primary key default gen_random_uuid(),
  enquiry_id    uuid not null references enquiry(id) on delete cascade,
  type          text not null,
  body          text not null,
  actor_id      uuid references app_user(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index enquiry_event_idx on enquiry_event (enquiry_id, created_at desc);

-- ---------------------------------------------------------------- bookings
create table booking (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique not null default 'BKG-' || to_char(nextval('booking_ref_seq'), 'FM0000'),
  client_id     uuid not null references client(id) on delete restrict,
  enquiry_id    uuid references enquiry(id) on delete set null,
  partner_id    uuid references partner(id) on delete set null,
  service_id    uuid not null references service(id) on delete restrict,
  addons        jsonb not null default '[]'::jsonb,
  duration_min  int not null check (duration_min > 0),
  guests        int not null default 1 check (guests > 0),
  concurrent    boolean not null default false,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  buffer_before_min int not null default 20 check (buffer_before_min >= 0),
  buffer_after_min  int not null default 20 check (buffer_after_min >= 0),
  location_type location_type not null default 'home',
  city          text not null default 'Accra',
  area          text not null default '',
  address       text not null default '',
  landmark      text not null default '',
  maps_link     text not null default '',
  hotel_name    text not null default '',
  room_no       text not null default '',
  base_pesewas      int not null default 0 check (base_pesewas >= 0),
  transport_pesewas int not null default 0 check (transport_pesewas >= 0),
  addons_pesewas    int not null default 0 check (addons_pesewas >= 0),
  discount_pesewas  int not null default 0 check (discount_pesewas >= 0),
  tax_pesewas       int not null default 0 check (tax_pesewas >= 0),
  total_pesewas     int not null default 0 check (total_pesewas >= 0),
  status        booking_status not null default 'awaiting_confirmation',
  payment_status payment_status not null default 'unpaid',
  consent_confirmed boolean not null default false,
  notes_internal    text not null default '',
  instructions_client text not null default '',
  source        text not null default 'direct_unknown',
  campaign      text not null default '',
  cancel_reason text,
  cancel_fee_pesewas int not null default 0 check (cancel_fee_pesewas >= 0),
  created_by    uuid references app_user(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_by    uuid references app_user(id) on delete set null,
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  constraint booking_ends_after_start check (ends_at > starts_at),
  constraint booking_cancel_needs_reason
    check (status not in ('cancelled_client','cancelled_business')
           or (cancel_reason is not null and cancel_reason <> ''))
);
create index booking_starts_idx  on booking (starts_at);
create index booking_status_idx  on booking (status) where archived_at is null;
create index booking_client_idx  on booking (client_id);
create index booking_partner_idx on booking (partner_id) where partner_id is not null;

alter table enquiry
  add constraint enquiry_booking_fk foreign key (booking_id) references booking(id) on delete set null;

create table booking_therapist (
  booking_id    uuid not null references booking(id) on delete cascade,
  therapist_id  uuid not null references therapist(id) on delete restrict,
  primary key (booking_id, therapist_id)
);
create index booking_therapist_by_therapist on booking_therapist (therapist_id);

create table booking_event (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references booking(id) on delete cascade,
  body          text not null,
  actor_id      uuid references app_user(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index booking_event_idx on booking_event (booking_id, created_at desc);

-- ---------------------------------------------------------------- money
create table payment (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique not null default 'PAY-' || to_char(nextval('payment_ref_seq'), 'FM0000'),
  booking_id    uuid not null references booking(id) on delete restrict,
  client_id     uuid not null references client(id) on delete restrict,
  -- refunds are stored negative, so sum(amount) is always the net collected
  amount_pesewas int not null check (amount_pesewas <> 0),
  kind          payment_kind not null,
  method        text not null,
  provider_ref  text not null default '',
  received_at   timestamptz not null default now(),
  actor_id      uuid references app_user(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint payment_sign check (
    (kind = 'refund' and amount_pesewas < 0) or (kind <> 'refund' and amount_pesewas > 0)
  )
);
create index payment_booking_idx  on payment (booking_id);
create index payment_received_idx on payment (received_at);

create table expense (
  id            uuid primary key default gen_random_uuid(),
  category      text not null,
  spent_on      date not null default (now() at time zone 'Africa/Accra')::date,
  vendor        text not null,
  amount_pesewas int not null check (amount_pesewas > 0),
  method        text not null,
  provider_ref  text not null default '',
  partner_id    uuid references partner(id) on delete set null,
  therapist_id  uuid references therapist(id) on delete set null,
  notes         text not null default '',
  actor_id      uuid references app_user(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index expense_spent_idx on expense (spent_on);

-- ---------------------------------------------------------------- marketing
create table marketing_daily (
  id            uuid primary key default gen_random_uuid(),
  day           date not null,
  platform      text not null,
  campaign      text not null default '',
  spend_pesewas int not null default 0 check (spend_pesewas >= 0),
  impressions   int not null default 0 check (impressions >= 0),
  clicks        int not null default 0 check (clicks >= 0),
  enquiries     int not null default 0 check (enquiries >= 0),
  bookings      int not null default 0 check (bookings >= 0),
  revenue_pesewas int not null default 0 check (revenue_pesewas >= 0),
  created_at    timestamptz not null default now(),
  unique (day, platform, campaign)
);
create index marketing_day_idx on marketing_daily (day desc);

-- ---------------------------------------------------------------- tasks
create table task (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  type          text not null default 'follow_up',
  priority      task_priority not null default 'normal',
  status        task_status not null default 'open',
  due_at        timestamptz,
  assignee_id   uuid references app_user(id) on delete set null,
  linked_type   text,
  linked_id     uuid,
  notes         text not null default '',
  created_by    uuid references app_user(id) on delete set null,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index task_open_idx on task (status, due_at);

-- ---------------------------------------------------------------- config
create table settings (
  id            boolean primary key default true check (id),   -- single row
  business_name text not null default 'SpaWellGhana',
  whatsapp_e164 text not null default '+233208458575',
  currency      text not null default 'GHS',
  timezone      text not null default 'Africa/Accra',
  cities        text[] not null default '{Accra,Kumasi}',
  attribution   text not null default 'first_touch',
  tax_enabled   boolean not null default false,
  tax_rate      numeric(5,2) not null default 0,
  retention_note text not null default '',
  privacy_note  text not null default '',
  updated_at    timestamptz not null default now()
);

create table message_template (
  key           text primary key,
  name          text not null,
  body          text not null
);

create table automation_rule (
  key           text primary key,
  name          text not null,
  threshold_value numeric not null,
  unit          text not null,
  effect        text not null,
  enabled       boolean not null default true
);

create table lookup_value (          -- lead sources, lost reasons, payment methods, partner types
  kind          text not null,
  value         text not null,
  label         text not null,
  sort_order    int not null default 0,
  primary key (kind, value)
);

-- ---------------------------------------------------------------- audit
create table audit_log (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  actor_id      uuid references app_user(id) on delete set null,
  actor_name    text,
  actor_role    app_role,
  action        text not null,
  record_type   text not null,
  record_id     text,
  before        jsonb,
  after         jsonb
);
create index audit_at_idx on audit_log (at desc);
create index audit_record_idx on audit_log (record_type, record_id);
