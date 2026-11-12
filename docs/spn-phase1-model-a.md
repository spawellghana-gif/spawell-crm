# SPN Model A — Phase 1 architecture and migration map

Status: review branch only. Do not deploy or run migration on production before review.

## Existing entities (preserved)
- `partner`: partner identity, status, commission_pct and contact details.
- `enquiry.partner_id`: existing marketing attribution.
- `booking.partner_id`: existing booking attribution.
- `payment`: signed payment entries in pesewas; refunds negative.
- `expense`: legacy partner commission disbursements.
- `partner_ledger`: legacy calculated view; not authoritative for new payouts.
- `app_user`: owner/officer/therapist roles.

## Additive migration
`0006_spn_phase1.sql` adds optional partner codes and approval metadata, a referral-claim table, and a future commission transaction ledger. No legacy data is rewritten or backfilled. Partner codes for historical rows remain null until reviewed.

## Model A rules
1. Only staff may capture and link referrals. Partners do not confirm bookings.
2. One referral claim per booking. Existing booking.partner_id remains unchanged.
3. No automatic commission payouts in Phase 1.
4. Commission entries are owner-only and do not replace the existing reporting view yet.
5. Payment must be verified and service completed before a later reconciliation engine can approve commission.
6. Existing auth roles, booking flows, and payment triggers remain untouched.

## Before rollout
- Review live migration history and database schema drift.
- Verify `is_staff()`, `is_owner()`, `audit_change()` functions exist.
- Test migration in disposable Supabase project, including RLS impersonation and rollback.
- Decide how existing partner ledger and expense payouts will be reconciled to the new ledger.
- Add server-side referral intake, validation, booking linkage and UI in a later PR.
- Confirm RLS policies against actual Supabase authenticated and service roles.
