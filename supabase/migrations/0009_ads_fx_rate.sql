-- The Google Ads account bills in USD; this CRM reports in GHS. The rate that
-- converts one to the other is a business fact that changes weekly, so it
-- belongs in settings where the owner can correct it — not hard-coded in a
-- sync job, and not hidden in a campaign label.
alter table settings add column if not exists ads_usd_ghs_rate numeric(10,4) not null default 11.39;
alter table settings add column if not exists ads_last_sync_at timestamptz;

comment on column settings.ads_usd_ghs_rate is
  'USD to GHS rate used when importing Google Ads spend. Update this when the rate moves materially; past imported rows keep the rate they were converted at.';

-- Record the rate each row was converted at, so a later rate change never
-- silently restates what a past month cost.
alter table marketing_daily add column if not exists source_currency text not null default '';
alter table marketing_daily add column if not exists fx_rate numeric(10,4);

comment on column marketing_daily.fx_rate is
  'Rate used to convert source_currency into the stored GHS pesewas. Null means the figure was entered in GHS directly.';

update marketing_daily
   set source_currency = 'USD', fx_rate = 11.39,
       campaign = replace(campaign, ' (usd@11.39)', '')
 where campaign like '%(usd@11.39)%';
