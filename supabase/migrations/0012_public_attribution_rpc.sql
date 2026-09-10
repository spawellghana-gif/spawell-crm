create or replace function public.capture_ad_click(
  p_token text,
  p_gclid text default '',
  p_gbraid text default '',
  p_wbraid text default '',
  p_utm_source text default '',
  p_utm_medium text default '',
  p_utm_campaign text default '',
  p_utm_term text default '',
  p_utm_content text default '',
  p_landing_page text default '',
  p_referrer text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := upper(trim(coalesce(p_token, '')));
  v_gclid text := left(trim(coalesce(p_gclid, '')), 200);
  v_gbraid text := left(trim(coalesce(p_gbraid, '')), 200);
  v_wbraid text := left(trim(coalesce(p_wbraid, '')), 200);
  v_utm_source text := left(trim(coalesce(p_utm_source, '')), 100);
  v_utm_medium text := left(trim(coalesce(p_utm_medium, '')), 100);
  v_utm_campaign text := left(trim(coalesce(p_utm_campaign, '')), 200);
  v_utm_term text := left(trim(coalesce(p_utm_term, '')), 200);
  v_utm_content text := left(trim(coalesce(p_utm_content, '')), 200);
  v_landing_page text := left(trim(coalesce(p_landing_page, '')), 500);
  v_referrer text := left(trim(coalesce(p_referrer, '')), 500);
begin
  if v_token !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception 'Invalid attribution token.' using errcode = '22023';
  end if;

  if v_gclid = '' and v_gbraid = '' and v_wbraid = '' and v_utm_source = '' and v_utm_medium = '' then
    raise exception 'Attribution evidence is required.' using errcode = '22023';
  end if;

  insert into public.ad_click (
    token, gclid, gbraid, wbraid,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    landing_page, referrer
  ) values (
    v_token, v_gclid, v_gbraid, v_wbraid,
    v_utm_source, v_utm_medium, v_utm_campaign, v_utm_term, v_utm_content,
    v_landing_page, v_referrer
  );
end;
$$;

revoke all on function public.capture_ad_click(text,text,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.capture_ad_click(text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;
