-- SpaWell CRM — seed.
-- Your real catalogue and configuration. NO fake clients, enquiries or
-- bookings: this database is for live customer data from day one, and seeded
-- pretend people have a way of being mistaken for real ones later.
--
-- Prices are in pesewas (45000 = GHS 450.00). Set them to YOUR prices before
-- going live — the values below are the ones from the preview and are
-- placeholders, not confirmed SpaWellGhana rates.

insert into settings (id, business_name, whatsapp_e164, retention_note, privacy_note)
values (true, 'SpaWellGhana', '+233208458575',
  'Booking and payment records are kept for 6 years for tax purposes. Marketing contact data is deleted 24 months after the last interaction unless the client re-consents.',
  'SpaWellGhana collects only the details needed to deliver a booking: name, phone, service address and service preferences. We do not collect medical histories in this system. Clients may request deletion at any time.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- services
insert into service (name, buffer_min, sort_order) values
  ('Relaxation Massage', 15, 1),
  ('Deep Tissue Massage', 15, 2),
  ('Swedish Massage',     15, 3),
  ('Full Body Massage',   20, 4),
  ('Reflexology Massage', 10, 5),
  ('Thai Massage',        20, 6)
on conflict (name) do nothing;

insert into service_option (service_id, duration_min, price_pesewas)
select s.id, v.duration_min, v.price_pesewas from service s
join (values
  ('Relaxation Massage',  60, 45000), ('Relaxation Massage',  90, 62000),
  ('Deep Tissue Massage', 60, 52000), ('Deep Tissue Massage', 90, 70000),
  ('Swedish Massage',     60, 48000), ('Swedish Massage',     90, 66000),
  ('Full Body Massage',   90, 74000), ('Full Body Massage',  120, 94000),
  ('Reflexology Massage', 45, 34000), ('Reflexology Massage', 60, 43000),
  ('Thai Massage',        60, 56000), ('Thai Massage',        90, 76000)
) as v(service_name, duration_min, price_pesewas) on v.service_name = s.name
on conflict do nothing;

insert into service_addon (service_id, name, price_pesewas)
select s.id, v.addon, v.price from service s
join (values
  ('Relaxation Massage',  'Hot stone add-on',          12000),
  ('Deep Tissue Massage', 'Extra focus area',           9000),
  ('Swedish Massage',     'Aromatherapy oil',           8000),
  ('Full Body Massage',   'Scalp & foot extension',    11000),
  ('Reflexology Massage', 'Herbal foot soak',           7000),
  ('Thai Massage',        'Extended stretch sequence', 10000)
) as v(service_name, addon, price) on v.service_name = s.name
on conflict do nothing;

-- ---------------------------------------------------------------- zones
insert into zone (name, transport_fee_pesewas) values
  ('Accra Central',              6000),
  ('Osu / Labone / Cantonments', 7000),
  ('East Legon / Airport',       8000),
  ('Spintex / Baatsona',         9000),
  ('Tema',                      12000),
  ('Kumasi Central',            15000)
on conflict (name) do nothing;

-- ---------------------------------------------------------------- lookups
insert into lookup_value (kind, value, label, sort_order) values
  ('lead_source','google_search_ads','Google Search Ads',1),
  ('lead_source','google_organic','Google Organic',2),
  ('lead_source','instagram_ads','Instagram Ads',3),
  ('lead_source','instagram_organic','Instagram Organic',4),
  ('lead_source','facebook','Facebook',5),
  ('lead_source','tiktok','TikTok',6),
  ('lead_source','referral','Referral',7),
  ('lead_source','repeat_client','Repeat client',8),
  ('lead_source','hotel_partner','Hotel partner',9),
  ('lead_source','direct_unknown','Direct/Unknown',10),
  ('lead_source','other','Other',11),
  ('channel','whatsapp','WhatsApp',1),
  ('channel','phone_call','Phone call',2),
  ('channel','website','Website',3),
  ('channel','instagram','Instagram',4),
  ('channel','google_business','Google Business Profile',5),
  ('channel','referral','Referral',6),
  ('channel','walk_in','Walk-in',7),
  ('channel','other','Other',8),
  ('lost_reason','price','Price',1),
  ('lost_reason','no_response','No response',2),
  ('lost_reason','outside_area','Outside service area',3),
  ('lost_reason','no_therapist','No therapist available',4),
  ('lost_reason','timing','Timing unavailable',5),
  ('lost_reason','competitor','Chose competitor',6),
  ('lost_reason','changed_mind','Changed mind',7),
  ('lost_reason','duplicate','Duplicate',8),
  ('lost_reason','spam','Invalid/spam',9),
  ('lost_reason','other','Other',10),
  ('payment_method','mobile_money','Mobile Money',1),
  ('payment_method','cash','Cash',2),
  ('payment_method','bank_transfer','Bank transfer',3),
  ('payment_method','card','Card',4),
  ('expense_category','therapist_payout','Therapist payout',1),
  ('expense_category','partner_commission','Partner commission',2),
  ('expense_category','transport','Transport',3),
  ('expense_category','supplies','Supplies',4),
  ('expense_category','advertising','Advertising',5),
  ('expense_category','software','Software',6),
  ('expense_category','phone_data','Phone/Data',7),
  ('expense_category','refunds','Refunds',8),
  ('expense_category','other','Other',9)
on conflict (kind, value) do nothing;

-- ---------------------------------------------------------------- templates
insert into message_template (key, name, body) values
  ('quote','Quote','Hello {name}, thank you for contacting SpaWellGhana. A {service} ({duration} mins) at your {location} in {area} is {amount}, including transport. Would you like me to hold a slot for {date}?'),
  ('confirm','Booking confirmation','Hello {name}, your {service} is confirmed for {date} at {time}. Therapist: {therapist}. Total {amount}. Please have a quiet room and a towel ready. — SpaWellGhana'),
  ('enroute','Therapist en route','Hello {name}, your therapist {therapist} is on the way to {area} and should arrive by {time}. — SpaWellGhana'),
  ('reminder','Appointment reminder','Hello {name}, a reminder of your {service} tomorrow, {date} at {time}. Reply here if anything needs to change. — SpaWellGhana'),
  ('thanks','Thank you','Thank you for choosing SpaWellGhana, {name}. We hope you enjoyed your {service}. Anything we could do better?'),
  ('review','Review request','Hello {name}, if you enjoyed your session with {therapist}, a short Google review helps us a lot. Thank you!'),
  ('rebook','Rebooking','Hello {name}, it has been a few weeks since your last {service}. Would you like the same slot this week? Your regular therapist {therapist} is available.'),
  ('balance','Balance due','Hello {name}, there is an outstanding balance of {balance} on booking {booking}. You can send it by Mobile Money to {biz_whatsapp}. Thank you.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- automations
insert into automation_rule (key, name, threshold_value, unit, effect, enabled) values
  ('A1','New enquiry with no response logged',        10,'minutes','Urgent alert',       true),
  ('A2','Quoted enquiry with no reply',                4,'hours',  'Follow-up task',     true),
  ('A3','Unconfirmed booking after quote',             2,'hours',  'Follow-up task',     true),
  ('A4','Confirmed booking before appointment',       24,'hours',  'Reminder due',       true),
  ('A5','No therapist assigned before appointment',    4,'hours',  'Urgent alert',       true),
  ('A6','Completed booking with balance due',          0,'hours',  'Payment follow-up',  true),
  ('A7','Completed booking thank-you and review',      2,'hours',  'Review task',        true),
  ('A8','Completed booking rebooking nudge',          21,'days',   'Rebooking task',     true),
  ('A9','Missing daily marketing spend by 8:00 PM',   20,'hour',   'Dashboard warning',  true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- therapists
-- Replace these with your real team, then set pay in Settings.
insert into therapist (full_name, phone_e164, gender, base_area, work_days, work_start, work_end, max_daily, rating) values
  ('Ama Boateng',  '+233201230001','female','East Legon','{1,2,3,4,5,6}','09:00','20:00',4,4.9),
  ('Kwame Mensah', '+233201230002','male',  'Osu',       '{1,2,3,4,5,6}','09:00','20:00',4,4.7),
  ('Efua Owusu',   '+233201230003','female','Spintex',   '{1,2,3,4,5,6}','09:00','20:00',3,4.8),
  ('Yaw Darko',    '+233201230004','male',  'Tema',      '{1,2,3,4,5,6}','09:00','20:00',3,4.5)
on conflict do nothing;

insert into therapist_pay (therapist_id, commission_pct)
select id, 35 from therapist on conflict (therapist_id) do nothing;

-- Everyone can do everything except Thai and Deep Tissue, which are trained.
insert into therapist_service (therapist_id, service_id)
select t.id, s.id from therapist t cross join service s
where s.name not in ('Thai Massage','Deep Tissue Massage')
on conflict do nothing;
insert into therapist_service (therapist_id, service_id)
select t.id, s.id from therapist t cross join service s
where s.name = 'Thai Massage' and t.full_name in ('Kwame Mensah','Yaw Darko')
on conflict do nothing;
insert into therapist_service (therapist_id, service_id)
select t.id, s.id from therapist t cross join service s
where s.name = 'Deep Tissue Massage' and t.full_name in ('Kwame Mensah','Efua Owusu','Yaw Darko')
on conflict do nothing;

-- ---------------------------------------------------------------- partners
insert into partner (name, type, status, area, contact_name, contact_role, phone_e164, whatsapp_e164, email, commission_pct, payment_terms, payout_method) values
  ('Kempinski Gold Coast City','hotel','active','Ridge','Nii Armah','Concierge manager','+233302611000','+233302611000',null,15,'Monthly invoice, net 14','Bank transfer'),
  ('Labadi Beach Hotel','hotel','active','Labadi','Adwoa Tetteh','Guest services lead','+233302772501','+233302772501',null,15,'Monthly invoice, net 14','Bank transfer'),
  ('Movenpick Ambassador','hotel','in_discussion','Ridge','Kobby Ansah','Spa desk supervisor','+233302611500','+233302611500',null,18,'Monthly invoice, net 30','Bank transfer')
on conflict do nothing;
