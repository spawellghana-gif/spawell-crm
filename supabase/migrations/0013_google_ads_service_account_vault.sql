create or replace function public.set_google_ads_service_account(
  p_client_email text,
  p_private_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_payload text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_owner() then
    raise exception 'Owner access required.' using errcode = '42501';
  end if;

  if trim(coalesce(p_client_email, '')) = '' then
    raise exception 'Service account client_email is required.' using errcode = '22023';
  end if;
  if position('BEGIN PRIVATE KEY' in coalesce(p_private_key, '')) = 0
     or position('END PRIVATE KEY' in coalesce(p_private_key, '')) = 0 then
    raise exception 'A valid PEM private_key is required.' using errcode = '22023';
  end if;

  v_payload := jsonb_build_object(
    'client_email', trim(p_client_email),
    'private_key', p_private_key
  )::text;

  select id into v_id
  from vault.decrypted_secrets
  where name = 'google_ads_service_account'
  order by created_at desc
  limit 1;

  if v_id is null then
    perform vault.create_secret(
      v_payload,
      'google_ads_service_account',
      'SpaWell CRM Google Data Manager service account',
      null
    );
  else
    perform vault.update_secret(
      v_id,
      v_payload,
      'google_ads_service_account',
      'SpaWell CRM Google Data Manager service account',
      null
    );
  end if;
end;
$$;

create or replace function public.get_google_ads_service_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_owner() then
    raise exception 'Owner access required.' using errcode = '42501';
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'google_ads_service_account'
  order by created_at desc
  limit 1;

  if v_secret is null or btrim(v_secret) = '' then
    return '{}'::jsonb;
  end if;
  return v_secret::jsonb;
end;
$$;

create or replace function public.google_ads_service_account_status()
returns table(configured boolean, client_email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_owner() then
    raise exception 'Owner access required.' using errcode = '42501';
  end if;

  select decrypted_secret::jsonb into v_secret
  from vault.decrypted_secrets
  where name = 'google_ads_service_account'
  order by created_at desc
  limit 1;

  configured := coalesce(v_secret ? 'client_email', false)
    and coalesce(v_secret ? 'private_key', false)
    and coalesce(length(v_secret->>'client_email') > 0, false)
    and coalesce(length(v_secret->>'private_key') > 0, false);
  client_email := case when configured then v_secret->>'client_email' else null end;
  return next;
end;
$$;

revoke all on function public.set_google_ads_service_account(text,text) from public;
revoke all on function public.get_google_ads_service_account() from public;
revoke all on function public.google_ads_service_account_status() from public;
grant execute on function public.set_google_ads_service_account(text,text) to authenticated, service_role;
grant execute on function public.get_google_ads_service_account() to authenticated, service_role;
grant execute on function public.google_ads_service_account_status() to authenticated, service_role;
