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
  **Sync now** and **Retry** actions use their authenticated CRM session.
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
