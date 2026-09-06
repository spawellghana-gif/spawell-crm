# SpaWell CRM

Production build of the SpaWellGhana CRM: Next.js (App Router) + TypeScript on
Vercel, Supabase for Postgres, Auth and Row Level Security.

Money is stored in **pesewas** (integers) throughout — `45000` is GHS 450.00.
Timezone is **Africa/Accra**. Phone numbers are stored **E.164** (`+233…`).

---

## Deploy it

You need a Supabase account and a Vercel account. Both have free tiers that
comfortably run a business this size. Budget about 30 minutes.

### Already done for you

The Supabase project **`gpuqaukkbxwvtjzrhoro`** (London) is created, all five
migrations are applied, and the catalogue is seeded. `src/lib/supabase/config.ts`
already points at it. You only need step 3 (create your login) and step 5
(deploy). Steps 1 and 2 are kept for reference, or for setting up a second
environment.

### 1. Create the Supabase project

1. supabase.com → **New project**. Pick the region closest to Ghana —
   **eu-west-2 (London)** or **eu-central-1 (Frankfurt)** are the usual best
   latency from Accra.
2. Save the database password somewhere safe.
3. When it finishes provisioning, go to **Project Settings → API** and copy:
   - Project URL
   - `anon` public key
   - `service_role` key (secret — server-side only, never in the browser)

### 2. Create the schema

Either with the CLI (recommended, keeps migrations under version control):

```bash
npm install -g supabase
supabase link --project-ref YOUR_PROJECT_REF
supabase db push          # applies supabase/migrations/*.sql in order
```

Or by hand: open **SQL Editor** in the Supabase dashboard and run these four
files **in order**, one at a time:

```
supabase/migrations/0001_schema.sql     tables, types, indexes
supabase/migrations/0002_security.sql   RLS policies and grants
supabase/migrations/0003_functions.sql  triggers, totals, availability, audit
supabase/migrations/0004_views.sql      reporting views and dashboard metrics
supabase/migrations/0005_harden_function_grants.sql   closes the RPC surface
```

Then run `supabase/seed.sql` once. It loads your services, prices, transport
zones, message templates, automation rules, and the three hotel partners.
**It deliberately seeds no clients, enquiries or bookings** — this database is
for real customer data from the first day, and seeded pretend people have a way
of being mistaken for real ones six months later.

Before you go live, edit the prices in `seed.sql` (or in the Supabase table
editor) to your real rates. The values shipped are the ones from the preview
and are placeholders.

### 3. Create your login

**Authentication → Users → Add user**, with your own email and a password.
Tick "Auto Confirm User".

The `handle_new_user` trigger gives **the first account the owner role** and
everyone after it booking officer. So create yours first.

For each therapist who should sign in: create their user, then in the
**therapist** table set that row's `user_id` to their new auth user id. Without
that link the app cannot tell which appointments are theirs, and they will
correctly see nothing.

### 4. Run it locally

```bash
cp .env.example .env.local     # fill in the three Supabase values
npm install
npm run dev                    # http://localhost:3000
```

### 5. Ship it to Vercel

```bash
git init && git add -A && git commit -m "SpaWell CRM"
# push to a private GitHub repo, then:
```

vercel.com → **Add New → Project** → import the repo. Add the environment
variables from `.env.local` (Settings → Environment Variables), then deploy.

Finally, in Supabase → **Authentication → URL Configuration**, set the Site URL
to your Vercel domain so password links point to the right place.

---

## How the permissions actually work

This is the part worth understanding, because it is what makes the system
safe to hold client records.

**Roles are enforced in the database, not in the interface.** Every table has
Row Level Security enabled, so a request returns only the rows that caller is
allowed to see. Hiding a menu item is cosmetic; the policies in
`0002_security.sql` hold even if someone calls the API directly with the
public key, from curl or a future phone app.

| | Owner/Admin | Booking Officer | Therapist |
|---|---|---|---|
| Enquiries, clients, partners, bookings | full | full | only their own bookings, and only the clients on them |
| Therapist pay | yes | **no rows returned** | **no rows returned** |
| Record a payment | yes | yes | only on their own booking |
| Reverse a payment or expense | yes | no | no |
| Settings, users, audit log | yes | no | no |

Three details that matter:

- **Therapist pay is a separate table** (`therapist_pay`), not a column on
  `therapist`. RLS filters rows, not columns — if commission sat on the
  therapist row, anyone who can read the roster to assign a booking could read
  everyone's pay. A separate owner-only table makes it enforceable.
- **A therapist can move their own job along but not rewrite it.** The
  `booking_therapist_guard` trigger rejects any change to the client, time or
  price, and rejects statuses outside their working set. They can set En route,
  Arrived, In service, Completed, No-show.
- **The audit log is append-only.** Triggers write it; there is no update or
  delete policy on the table, so not even the owner can quietly edit history.

Every one of these was tested against a live Postgres before shipping —
including that an officer's `delete from payment` removes zero rows and a
therapist's `select from therapist_pay` returns nothing.

## Things the database decides, not the browser

Put in SQL deliberately, so a second client cannot get them wrong:

- **Booking totals.** `base + transport + add-ons − discount + tax`, recomputed
  on every write. A client cannot post an inconsistent total.
- **Payment status.** Derived from the payment rows. Record a deposit and it
  becomes part-paid; settle it and a completed booking moves itself to paid;
  refund it and it becomes refunded. Refunds are stored as negative amounts so
  `sum(amount_pesewas)` is always the true net collected.
- **Availability.** `therapist_availability(...)` answers with one of: inactive,
  not a working day, time off, outside hours, daily maximum reached, clashes
  with another booking — counting travel buffers on both sides. Assignment
  warns and lets you override deliberately.
- **Dashboard metrics.** `dashboard_metrics(from, to)` computes the KPIs in one
  round trip, using the same definitions as the preview.

## What is here and what is not

Ported and working: login and roles, dashboard, enquiries (list, capture,
detail, interaction log, mark lost with a reason, one-click convert to booking
keeping attribution), bookings (list, detail, status flow, dispatch with
availability checks, reschedule, cancel with reason, deposits/balances/refunds,
prefilled WhatsApp templates), clients, partners with the commission ledger and
payouts, therapists, services, tasks, finance, settings with users and the
audit log.

Not yet ported from the preview — the data model and policies already support
them, they need the pages: the **dispatch calendar** (day/week/month lanes),
**marketing spend entry and attribution**, and the **report tabs with CSV
export**. The preview remains the reference for how those should look and
behave.

Still simulated, exactly as in the preview: **WhatsApp** buttons build a correct
`wa.me` link and open it — the Cloud API is not wired up, so nothing sends by
itself; and **payments** are recorded as data, with no processor behind them.
Card details are never stored anywhere in this system, and should not be —
production capture belongs with a licensed provider (Paystack and Hubtel both
handle Mobile Money well in Ghana).

## Before real client data goes in

- Turn on **Point-in-Time Recovery** in Supabase (Database → Backups) and
  restore once to prove it works. An untested backup is not a backup.
- Review the **Ghana Data Protection Act (Act 843)** obligations and register
  with the Data Protection Commission if required. Publish the privacy notice
  in Settings.
- Keep the `service_role` key out of the browser and out of git. Nothing in
  this app needs it; it is there for scheduled jobs you add later.
- Collect the minimum you need. There is no medical history field in this
  schema on purpose — a consent flag and a private note only.

## Next steps worth taking

1. **Generate typed database types** instead of the hand-written ones:
   `npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts`
2. **Wire WhatsApp** (Cloud API) — templates are already in
   `message_template`, and `automation_rule` holds the timings.
3. **Automations** as Supabase scheduled Edge Functions, reading
   `automation_rule` so the owner can retune them without a deploy.
4. **Port the calendar**, the piece the operator will miss most.
