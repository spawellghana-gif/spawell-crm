# Google Ads attribution update

This update adds a Google Ads page, a WhatsApp reference field on enquiries,
booking attribution, and a queue for confirmed-booking uploads. It preserves
the existing direct GA4 import and owner-only test-payment deletion.

## Enable the new integration

1. Apply `supabase/migrations/0010_google_ads_conversions.sql` to the CRM database
   through the existing migration process. It adds attribution fields, conversion
   tables, and access policies. Existing enquiries and bookings can still be saved
   before this migration is applied; the Ads dashboard displays a setup message.
2. Configure the server-only `SUPABASE_SERVICE_ROLE_KEY` in Vercel. Never commit
   credentials. After migration and server setup, new confirmations can queue.
3. Review `website-snippet.html` and install it on the separate WordPress website
   at `spawellghana.com`. Pushing this repository does not install that snippet.
   Verify that the actual WhatsApp links support the `text` query parameter;
   WhatsApp Business `wa.me/message/...` short links need separate verification.
   Copy a customer's `[ref: XXXXXX]` into the enquiry's WhatsApp ref field.
4. Configure Google's Data Manager API access and an appropriate Google Ads
   conversion action. Set `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_CONVERSION_ACTION`,
   `GOOGLE_ADS_SA_CLIENT_EMAIL`, and `GOOGLE_ADS_SA_PRIVATE_KEY` in Vercel.
   Set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` only when a manager account is involved.
   This code does not change campaign goals, budgets, bidding, or ads.
5. Keep `GOOGLE_ADS_SYNC_ENABLED=false` while setting up. As owner, use
   **Marketing → Google Ads → Validate** on a queued booking. Validation calls
   Google's validation mode and leaves the real queue and attempt counts intact.
6. Before live uploads, review customer-data collection and the conversion
   action's measurement settings. The current payload sends unspecified consent;
   a booking or phone number is not treated as evidence that consent was granted.
7. When ready, set `GOOGLE_ADS_SYNC_ENABLED=true`, redeploy, and use **Enable sync**
   in the CRM. Both the environment switch and the CRM switch must be on.
   **Pause sync** prevents future worker runs from sending; an in-flight request
   may already have reached Google.

## Scheduling and verification

- `vercel.json` schedules a daily GET at `0 1 * * *` (UTC), compatible with Hobby
  scheduling limits. Set a strong `CRON_SECRET` in Vercel; its scheduled request
  supplies the bearer header automatically. Exact timing depends on the plan.
- External POST callers use a separate `CONVERSION_SYNC_SECRET`. The owner's
  **Sync now** action invokes the protected GET worker when both worker secrets
  are configured in Vercel Production. This verifies the same cron credentials,
  database identity, and receipt processing immediately, and records the worker
  result. The secret stays server-side and is sent only to the fixed CRM origin;
  redirects are refused. Individual **Retry** actions, and environments without
  the worker configuration, retain the authenticated CRM-session path.
- On the current Hobby plan, the daily job can run anytime from 01:00 to 02:00
  Accra time. A manual worker run verifies the endpoint but does not prove that
  Vercel has delivered the next scheduled invocation.
- A successful upload stores Google's `requestId`. This confirms receipt of the
  upload, not that Google Ads has matched or attributed the conversion. Verify
  processing and reporting in Google Ads before relying on the figures.
- Backfill processes up to 500 eligible bookings with a recorded confirmation
  timestamp. Older bookings with no known confirmation time are not assigned a
  made-up timestamp.
- Cancellation marks the local row void and prevents a pending upload. This
  update does not retract previously uploaded conversions from Google Ads.
- No database migration, production credential change, WordPress installation,
  or live conversion upload is performed merely by pushing this repository.

## Checks

Run `npm test`, `npm run typecheck`, and `npm run build`.

References: [Google Data Manager ingestion](https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest),
[consent fields](https://developers.google.com/data-manager/api/reference/rest/v1/Consent),
[Vercel cron authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
[Vercel scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).


## Reliable queue and processing checks (September 2026)

Apply `20260913221054_reliable_conversion_reporting.sql` before deploying the
matching application changes. Confirmation creates its local conversion event
inside the database transaction. This requires no server credential and makes no
Google call. Owners can backfill missing records; the scheduled worker also checks
for gaps. Cancelled or archived bookings are voided locally. Reconfirmation retains
an existing receipt and transaction ID. Remote retractions are not implemented.

The uploader claims each event, then saves its result and append-only attempt
history atomically. A worker interrupted for ten minutes can be retried with the
same transaction ID. Validation does not mutate the queue. Existing historical
receipts are preserved; missing historical attempt logs are not fabricated.

`Uploaded` means Data Manager returned a request ID. `Check Google processing`
retrieves the per-destination request status and displays errors and warnings.
Processing success is ingestion success, not evidence of an attributed conversion
in Google Ads. Confirm the action in Ads reporting separately before changing
campaign goals or bidding.

The production Vercel project is `spawell-crm`, serving `crm.spawellghana.com`.
Its existing cron runs `/api/conversions/sync` daily at 01:00 UTC/Accra. Production
requires `CRON_SECRET` and server-only `SUPABASE_SERVICE_ROLE_KEY`; the optional
external POST uses `CONVERSION_SYNC_SECRET`. Never publish these values or add
an unauthenticated worker route. The CRM displays missing worker configuration
and the last recorded run. The database switch remains the upload control.

Verify with `npm test`, `npm run build`, and the rollback-only SQL script at
`supabase/tests/reliable_conversion_reporting.sql`. Then validate a real queued
booking using the owner controls, upload it once, and check processing. Verify a
scheduled invocation through its saved run time and result.
