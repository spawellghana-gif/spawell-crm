-- SpaWell CRM — Google Analytics 4.
--
-- Two directions, and they are separate problems:
--
--   IN   ga4_daily holds one row per day per traffic source, pulled from the
--        GA4 Data API. Joined against marketing_daily spend and the enquiries
--        that actually came in, it answers "what did a booking from Instagram
--        cost me" — which neither GA4 nor the CRM can answer alone, because
--        GA4 never sees the WhatsApp conversation and the CRM never sees the
--        visit.
--
--   OUT  A booking is an offline conversion. GA4 only learns about it if the
--        CRM tells it, and it can only attribute it to the right visit if the
--        website captured that visitor's GA client id and passed it along.
--        Hence ga_client_id on enquiry.
--
-- Credentials live in environment variables, never here: this file is in git.

-- ---------------------------------------------------------------- traffic
create table if not exists ga4_daily (
  day              date not null,
  -- GA4's own default channel grouping: "Organic Social", "Paid Search", …
  channel_group    text not null default '(other)',
  source_medium    text not null default '(not set)',
  campaign         text not null default '(not set)',
  sessions         int  not null default 0 check (sessions >= 0),
  active_users     int  not null default 0 check (active_users >= 0),
  engaged_sessions int  not null default 0 check (engaged_sessions >= 0),
  key_events       int  not null default 0 check (key_events >= 0),
  synced_at        timestamptz not null default now(),
  primary key (day, channel_group, source_medium, campaign)
);

comment on table ga4_daily is
  'One row per day per traffic source from the GA4 Data API. Re-syncing a day replaces its rows, so a re-run is always safe.';

create index if not exists ga4_daily_day_idx on ga4_daily (day desc);

-- ---------------------------------------------------- offline conversions
-- Captured by the website form and carried through to the booking, so a
-- conversion sent back to GA4 lands on the right visit rather than appearing
-- as a brand new direct user.
alter table enquiry add column if not exists ga_client_id  text not null default '';
alter table enquiry add column if not exists ga_session_id text not null default '';

comment on column enquiry.ga_client_id is
  'GA4 client id from the website form, used to attribute the resulting booking back to the visit that produced it. Empty when the enquiry came in by WhatsApp or phone.';

-- Whether the conversion has already been reported, so a retry or a second
-- deploy cannot double-count revenue in GA4.
alter table booking add column if not exists ga4_reported_at timestamptz;

-- ------------------------------------------------------------- settings
-- The property and measurement ids are identifiers, not secrets — they are
-- visible in any page's network tab. The API secret and the service account
-- key are secrets and stay in environment variables.
alter table settings add column if not exists ga4_property_id    text not null default '';
alter table settings add column if not exists ga4_measurement_id text not null default '';
alter table settings add column if not exists ga4_last_sync_at   timestamptz;

-- ------------------------------------------------------------- security
alter table ga4_daily enable row level security;

-- Staff read it; nothing writes through the API. The sync runs server-side
-- with the service key, which bypasses RLS by design.
create policy ga4_read  on ga4_daily for select using (is_staff());
create policy ga4_write on ga4_daily for all    using (is_owner()) with check (is_owner());

grant select, insert, update, delete on ga4_daily to authenticated;

-- --------------------------------------------------------------- the join
-- Traffic, spend and outcomes on one line per day and channel.
--
-- Deliberately full outer: a channel can have visits with no spend (organic),
-- spend with no visits yet (a campaign that started today), or enquiries with
-- neither (someone messaged the WhatsApp number off a flyer). Dropping any of
-- those would quietly overstate performance.
create or replace view marketing_performance
with (security_invoker = on) as
with traffic as (
  select day, channel_group as channel,
         sum(sessions) as sessions,
         sum(active_users) as users,
         sum(key_events) as ga_key_events
    from ga4_daily group by day, channel_group
), spend as (
  select day, platform as channel,
         sum(spend_pesewas) as spend_pesewas,
         sum(impressions) as impressions,
         sum(clicks) as clicks
    from marketing_daily group by day, platform
), enq as (
  select (created_at at time zone 'Africa/Accra')::date as day,
         source as channel,
         count(*) as enquiries,
         count(*) filter (where status = 'booked') as booked
    from enquiry where archived_at is null
   group by 1, 2
)
select
  coalesce(t.day, s.day, e.day)             as day,
  coalesce(t.channel, s.channel, e.channel) as channel,
  coalesce(t.sessions, 0)      as sessions,
  coalesce(t.users, 0)         as users,
  coalesce(t.ga_key_events, 0) as ga_key_events,
  coalesce(s.spend_pesewas, 0) as spend_pesewas,
  coalesce(s.impressions, 0)   as impressions,
  coalesce(s.clicks, 0)        as clicks,
  coalesce(e.enquiries, 0)     as enquiries,
  coalesce(e.booked, 0)        as booked,
  -- Cost per booking is the number worth looking at. Null rather than zero
  -- when nothing was booked: "no bookings yet" and "free" are not the same,
  -- and a zero here would average into a flattering lie.
  case when coalesce(e.booked, 0) > 0 and coalesce(s.spend_pesewas, 0) > 0
       then round(s.spend_pesewas::numeric / e.booked) end as cost_per_booking_pesewas,
  case when coalesce(t.sessions, 0) > 0
       then round(100.0 * coalesce(e.enquiries, 0) / t.sessions, 2) end as enquiry_rate_pct
from traffic t
full outer join spend s on s.day = t.day and s.channel = t.channel
full outer join enq   e on e.day = coalesce(t.day, s.day) and e.channel = coalesce(t.channel, s.channel);

grant select on marketing_performance to authenticated;
