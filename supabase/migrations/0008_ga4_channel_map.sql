-- GA4 names its channels its own way ("Organic Social", "Paid Search") and the
-- CRM names lead sources its way ("instagram_organic", "google_search_ads").
-- Without a mapping the join in 0007 produces two half-empty rows per channel
-- per day instead of one complete one, which reads as though paid traffic
-- produced no enquiries at all. This table is the translation, and the owner
-- can retune it from the Marketing page as GA4's groupings change.
create table if not exists ga4_channel_map (
  ga4_channel text primary key,
  crm_source  text not null
);

insert into ga4_channel_map (ga4_channel, crm_source) values
  ('Paid Search',      'google_search_ads'),
  ('Organic Search',   'google_organic'),
  ('Paid Social',      'instagram_ads'),
  ('Organic Social',   'instagram_organic'),
  ('Display',          'google_search_ads'),
  ('Referral',         'referral'),
  ('Direct',           'direct_unknown'),
  ('Unassigned',       'direct_unknown'),
  ('Email',            'other'),
  ('(other)',          'other')
on conflict (ga4_channel) do nothing;

alter table ga4_channel_map enable row level security;
drop policy if exists ga4_map_read  on ga4_channel_map;
drop policy if exists ga4_map_write on ga4_channel_map;
create policy ga4_map_read  on ga4_channel_map for select using (auth_role() is not null);
create policy ga4_map_write on ga4_channel_map for all    using (is_owner()) with check (is_owner());
grant select, insert, update, delete on ga4_channel_map to authenticated;

-- Rebuild the join through the mapping so one channel is one row per day.
create or replace view marketing_performance
with (security_invoker = on) as
with traffic as (
  select g.day,
         coalesce(m.crm_source, 'other') as channel,
         sum(g.sessions) as sessions,
         sum(g.active_users) as users,
         sum(g.key_events) as ga_key_events
    from ga4_daily g
    left join ga4_channel_map m on m.ga4_channel = g.channel_group
   group by 1, 2
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
  case when coalesce(e.booked, 0) > 0 and coalesce(s.spend_pesewas, 0) > 0
       then round(s.spend_pesewas::numeric / e.booked) end as cost_per_booking_pesewas,
  case when coalesce(t.sessions, 0) > 0
       then round(100.0 * coalesce(e.enquiries, 0) / t.sessions, 2) end as enquiry_rate_pct
from traffic t
full outer join spend s on s.day = t.day and s.channel = t.channel
full outer join enq   e on e.day = coalesce(t.day, s.day) and e.channel = coalesce(t.channel, s.channel);

grant select on marketing_performance to authenticated;
