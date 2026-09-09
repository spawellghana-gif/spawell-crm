-- SpaWellGhana does not charge travel separately: the service price is
-- all-inclusive. The zone fees shipped with the seed were placeholders from the
-- preview and were never this business's pricing.
--
-- The column is kept rather than dropped, deliberately:
--   * booking BKG-2008 records GHS 700 service + GHS 50 travel = GHS 750, and
--     GHS 750 was actually collected. Zeroing the split would make the payment
--     look like an overpayment against a GHS 700 booking. History stays true.
--   * a one-off out-of-area surcharge may one day be wanted; a defaulted,
--     unused column costs nothing and dropping it would lose the above.
--
-- What changes is the workflow: nothing computes or suggests a travel charge
-- any more, and zones become coverage areas rather than a price list.

update zone set transport_fee_pesewas = 0 where transport_fee_pesewas <> 0;

comment on column zone.transport_fee_pesewas is
  'Unused. SpaWellGhana prices are all-inclusive; travel is not charged separately. Kept at 0 so the booking total formula stays unchanged.';

comment on column booking.transport_pesewas is
  'Normally 0 — travel is included in the service price. Retained for historical bookings that recorded a split, and for a rare out-of-area surcharge.';

create index if not exists zone_name_idx on zone (name);
