-- SpaWell CRM — Row Level Security
--
-- The rule this file exists to enforce: a therapist can reach ONLY the
-- appointments assigned to them and the clients on those appointments, and
-- nobody but the owner can reach pay. That is enforced here, in the database,
-- so it holds no matter what calls the API — the web app, a stolen anon key,
-- a curl request, or a future mobile client.

-- ---------------------------------------------------------------- helpers
-- SECURITY DEFINER so the policies can read app_user without recursing
-- through app_user's own policies. STABLE so Postgres caches per statement.

create or replace function auth_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from app_user where id = auth.uid() and active
$$;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() = 'owner', false)
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() in ('owner','officer'), false)
$$;

create or replace function is_therapist() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() = 'therapist', false)
$$;

-- The therapist row belonging to the signed-in user, or null.
create or replace function my_therapist_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from therapist where user_id = auth.uid() and archived_at is null
$$;

-- Is this booking assigned to the signed-in therapist?
create or replace function assigned_to_me(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from booking_therapist bt
    where bt.booking_id = b and bt.therapist_id = my_therapist_id()
  )
$$;

-- ---------------------------------------------------------------- enable RLS
-- Every table. A table with RLS enabled and no policy denies everything,
-- which is the safe direction to fail.
alter table app_user            enable row level security;
alter table therapist           enable row level security;
alter table therapist_pay       enable row level security;
alter table therapist_time_off  enable row level security;
alter table service             enable row level security;
alter table service_option      enable row level security;
alter table service_addon       enable row level security;
alter table therapist_service   enable row level security;
alter table zone                enable row level security;
alter table partner             enable row level security;
alter table partner_event       enable row level security;
alter table client              enable row level security;
alter table enquiry             enable row level security;
alter table enquiry_event       enable row level security;
alter table booking             enable row level security;
alter table booking_therapist   enable row level security;
alter table booking_event       enable row level security;
alter table payment             enable row level security;
alter table expense             enable row level security;
alter table marketing_daily     enable row level security;
alter table task                enable row level security;
alter table settings            enable row level security;
alter table message_template    enable row level security;
alter table automation_rule     enable row level security;
alter table lookup_value        enable row level security;
alter table audit_log           enable row level security;

-- ---------------------------------------------------------------- people
create policy app_user_self_read on app_user for select
  using (id = auth.uid() or is_staff());
create policy app_user_owner_write on app_user for all
  using (is_owner()) with check (is_owner());

-- Everyone signed in can see the roster (needed to assign and to show names).
create policy therapist_read on therapist for select
  using (auth_role() is not null);
create policy therapist_owner_write on therapist for all
  using (is_owner()) with check (is_owner());

-- Pay: owner only, full stop. A therapist reading this table gets zero rows.
create policy therapist_pay_owner on therapist_pay for all
  using (is_owner()) with check (is_owner());

create policy time_off_read on therapist_time_off for select
  using (is_staff() or therapist_id = my_therapist_id());
create policy time_off_write on therapist_time_off for all
  using (is_owner() or therapist_id = my_therapist_id())
  with check (is_owner() or therapist_id = my_therapist_id());

-- ---------------------------------------------------------------- catalogue
-- Readable by all staff (a therapist needs the service name on their job);
-- writable by the owner only.
create policy service_read        on service          for select using (auth_role() is not null);
create policy service_write       on service          for all using (is_owner()) with check (is_owner());
create policy service_option_read on service_option   for select using (auth_role() is not null);
create policy service_option_write on service_option  for all using (is_owner()) with check (is_owner());
create policy service_addon_read  on service_addon    for select using (auth_role() is not null);
create policy service_addon_write on service_addon    for all using (is_owner()) with check (is_owner());
create policy th_service_read     on therapist_service for select using (auth_role() is not null);
create policy th_service_write    on therapist_service for all using (is_owner()) with check (is_owner());
create policy zone_read           on zone             for select using (auth_role() is not null);
create policy zone_write          on zone             for all using (is_owner()) with check (is_owner());

-- ---------------------------------------------------------------- partners
create policy partner_read  on partner for select using (is_staff());
create policy partner_write on partner for insert with check (is_staff());
create policy partner_edit  on partner for update using (is_staff()) with check (is_staff());
create policy partner_del   on partner for delete using (is_owner());

create policy partner_event_read  on partner_event for select using (is_staff());
create policy partner_event_write on partner_event for insert with check (is_staff());

-- ---------------------------------------------------------------- clients
-- Staff see every client. A therapist sees only the clients they are booked
-- to visit — the address and phone of a stranger is not theirs to read.
create policy client_read on client for select
  using (
    is_staff()
    or exists (
      select 1 from booking b
      where b.client_id = client.id and assigned_to_me(b.id)
    )
  );
create policy client_insert on client for insert with check (is_staff());
create policy client_update on client for update using (is_staff()) with check (is_staff());
create policy client_delete on client for delete using (is_owner());

-- ---------------------------------------------------------------- enquiries
create policy enquiry_read   on enquiry for select using (is_staff());
create policy enquiry_insert on enquiry for insert with check (is_staff());
create policy enquiry_update on enquiry for update using (is_staff()) with check (is_staff());
create policy enquiry_delete on enquiry for delete using (is_owner());

create policy enquiry_event_read   on enquiry_event for select using (is_staff());
create policy enquiry_event_insert on enquiry_event for insert with check (is_staff());

-- ---------------------------------------------------------------- bookings
create policy booking_read on booking for select
  using (is_staff() or assigned_to_me(id));
create policy booking_insert on booking for insert with check (is_staff());
-- A therapist may update a booking assigned to them (status as they work);
-- the status_only trigger in 0003 stops them changing price or client.
create policy booking_update on booking for update
  using (is_staff() or assigned_to_me(id))
  with check (is_staff() or assigned_to_me(id));
create policy booking_delete on booking for delete using (is_owner());

create policy bt_read   on booking_therapist for select
  using (is_staff() or therapist_id = my_therapist_id());
create policy bt_write  on booking_therapist for all
  using (is_staff()) with check (is_staff());

create policy booking_event_read on booking_event for select
  using (is_staff() or assigned_to_me(booking_id));
create policy booking_event_insert on booking_event for insert
  with check (is_staff() or assigned_to_me(booking_id));

-- ---------------------------------------------------------------- money
-- Therapists collect payment at the door, so they may record one against
-- their own booking and see those rows — but no business-wide figures.
create policy payment_read on payment for select
  using (is_staff() or assigned_to_me(booking_id));
create policy payment_insert on payment for insert
  with check (is_staff() or assigned_to_me(booking_id));
-- Money is never edited, only reversed by a compensating entry.
-- Deletion is the owner's alone, and lands in the audit log.
create policy payment_delete on payment for delete using (is_owner());

create policy expense_read   on expense for select using (is_staff());
create policy expense_insert on expense for insert with check (is_staff());
create policy expense_update on expense for update using (is_owner()) with check (is_owner());
create policy expense_delete on expense for delete using (is_owner());

create policy marketing_read   on marketing_daily for select using (is_staff());
create policy marketing_write  on marketing_daily for insert with check (is_staff());
create policy marketing_update on marketing_daily for update using (is_staff()) with check (is_staff());
create policy marketing_delete on marketing_daily for delete using (is_owner());

-- ---------------------------------------------------------------- tasks
create policy task_read on task for select
  using (is_staff() or assignee_id = auth.uid());
create policy task_insert on task for insert with check (auth_role() is not null);
create policy task_update on task for update
  using (is_staff() or assignee_id = auth.uid())
  with check (is_staff() or assignee_id = auth.uid());
create policy task_delete on task for delete using (is_owner());

-- ---------------------------------------------------------------- config
create policy settings_read  on settings for select using (auth_role() is not null);
create policy settings_write on settings for all using (is_owner()) with check (is_owner());
create policy template_read  on message_template for select using (auth_role() is not null);
create policy template_write on message_template for all using (is_owner()) with check (is_owner());
create policy rule_read      on automation_rule for select using (is_staff());
create policy rule_write     on automation_rule for all using (is_owner()) with check (is_owner());
create policy lookup_read    on lookup_value for select using (auth_role() is not null);
create policy lookup_write   on lookup_value for all using (is_owner()) with check (is_owner());

-- ---------------------------------------------------------------- audit
-- Read: owner only. Write: nobody through the API — the triggers in 0003 run
-- as SECURITY DEFINER and are the only thing that inserts here. There is
-- deliberately no update or delete policy, so the log is append-only even
-- for the owner.
create policy audit_read on audit_log for select using (is_owner());

-- ---------------------------------------------------------------- grants
-- Supabase gives every signed-in request the `authenticated` role; RLS above
-- does the real work. Revoke the blanket grants first so nothing is reachable
-- by accident, then hand back only what the policies then filter.
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- `anon` (not signed in) gets nothing at all.
