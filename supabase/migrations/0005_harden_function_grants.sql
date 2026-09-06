-- SpaWell CRM — close the RPC surface.
--
-- Supabase exposes every function in `public` at /rest/v1/rpc/<name>. A
-- SECURITY DEFINER function reachable there runs with the definer's rights, so
-- anything not meant to be called by a client needs EXECUTE revoked. Supabase's
-- own database linter flags these; this migration is the considered answer to
-- it, not a blanket application of its advice.
--
-- Two findings from testing this against a real Postgres before applying:
--
--   1. Revoking EXECUTE on a TRIGGER function does not stop the trigger firing.
--      Trigger dispatch does not check EXECUTE. So trigger functions can be
--      locked down completely with no loss of behaviour.
--
--   2. Revoking EXECUTE on the RLS HELPERS breaks every policy that calls them.
--      `select count(*) from booking` as a signed-in officer fails with
--      "permission denied for function is_staff". The linter's suggested
--      remediation, applied literally, takes the whole system down.
--
-- Hence the split below.

-- 1. Trigger functions and internals: nobody calls these directly, ever.
revoke execute on function audit_change()                    from anon, authenticated, public;
revoke execute on function booking_recalc()                  from anon, authenticated, public;
revoke execute on function payment_after_change()            from anon, authenticated, public;
revoke execute on function booking_therapist_guard()         from anon, authenticated, public;
revoke execute on function handle_new_user()                 from anon, authenticated, public;
revoke execute on function touch_updated_at()                from anon, authenticated, public;
-- Not a trigger function: a SECURITY DEFINER writer that would otherwise let
-- any signed-in caller re-sync any booking's payment status, bypassing RLS.
revoke execute on function booking_sync_payment_status(uuid) from anon, authenticated, public;

-- 2. RLS helpers: `authenticated` MUST keep EXECUTE (see finding 2 above).
--    The residual exposure is acceptable: each one reports only on the caller
--    themselves — their own role, their own therapist id, whether a given
--    booking is their own — so a client learns nothing it did not already know.
--    Signed-out callers lose access entirely.
revoke execute on function auth_role()          from anon, public;
revoke execute on function is_owner()           from anon, public;
revoke execute on function is_staff()           from anon, public;
revoke execute on function is_therapist()       from anon, public;
revoke execute on function my_therapist_id()    from anon, public;
revoke execute on function assigned_to_me(uuid) from anon, public;

-- 3. The three functions the app legitimately calls over RPC: signed-in only.
revoke execute on function therapist_availability(uuid, timestamptz, timestamptz, int, int, uuid) from anon, public;
revoke execute on function booking_conflicts(uuid, timestamptz, timestamptz, int, int, uuid)      from anon, public;
revoke execute on function dashboard_metrics(date, date) from anon, public;

-- 4. Pin the one function that was missing a fixed search_path. A mutable
--    search_path lets a caller shadow an unqualified name with their own
--    object; pinning it removes the question.
create or replace function touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;
revoke execute on function touch_updated_at() from anon, authenticated, public;

-- Remaining linter warnings after this migration, and why they stay:
--   * 8 x "authenticated can execute SECURITY DEFINER" — the six RLS helpers
--     plus therapist_availability and booking_conflicts, all required. See above.
--   * "extension citext in public" — cosmetic. Moving it would require
--     rewriting the partner.email column's type dependency; not worth the
--     churn on a live database for no security gain.
