/**
 * Hand-written row types matching supabase/migrations.
 * Regenerate properly once your project is up:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
 */

export type AppRole = "owner" | "officer" | "therapist";

export type EnquiryStatus =
  | "new" | "contacted" | "qualified" | "quoted"
  | "follow_up" | "booked" | "lost" | "spam";

export type BookingStatus =
  | "draft" | "awaiting_confirmation" | "confirmed" | "therapist_assigned"
  | "en_route" | "arrived" | "in_service" | "completed" | "paid"
  | "cancelled_client" | "cancelled_business" | "no_show" | "rescheduled" | "refunded";

export type PaymentStatus = "unpaid" | "part_paid" | "paid" | "refunded";
export type PaymentKind = "deposit" | "balance" | "refund";
export type LocationType = "home" | "hotel";

/** The order a booking normally travels in. Exceptions are set explicitly. */
export const BOOKING_FLOW: BookingStatus[] = [
  "draft", "awaiting_confirmation", "confirmed", "therapist_assigned",
  "en_route", "arrived", "in_service", "completed", "paid",
];

/** Statuses a therapist is allowed to set — mirrors booking_therapist_guard(). */
export const THERAPIST_STATUSES: BookingStatus[] = [
  "confirmed", "therapist_assigned", "en_route", "arrived", "in_service", "completed", "no_show",
];

export const STATUS_LABEL: Record<BookingStatus, string> = {
  draft: "Draft",
  awaiting_confirmation: "Awaiting confirmation",
  confirmed: "Confirmed",
  therapist_assigned: "Therapist assigned",
  en_route: "En route",
  arrived: "Arrived",
  in_service: "In service",
  completed: "Completed",
  paid: "Paid",
  cancelled_client: "Cancelled by client",
  cancelled_business: "Cancelled by SpaWellGhana",
  no_show: "No-show",
  rescheduled: "Rescheduled",
  refunded: "Refunded",
};

export const STATUS_TONE: Record<BookingStatus, string> = {
  draft: "", awaiting_confirmation: "warn", confirmed: "info",
  therapist_assigned: "info", en_route: "teal", arrived: "teal",
  in_service: "teal", completed: "ok", paid: "ok",
  cancelled_client: "bad", cancelled_business: "bad", no_show: "bad",
  rescheduled: "warn", refunded: "bad",
};

export const ENQUIRY_LABEL: Record<EnquiryStatus, string> = {
  new: "New", contacted: "Contacted", qualified: "Qualified", quoted: "Quoted",
  follow_up: "Follow-up", booked: "Booked", lost: "Lost", spam: "Spam",
};
export const ENQUIRY_TONE: Record<EnquiryStatus, string> = {
  new: "info", contacted: "teal", qualified: "teal", quoted: "warn",
  follow_up: "warn", booked: "ok", lost: "bad", spam: "",
};

export type BookingView = {
  id: string; ref: string; client_id: string; enquiry_id: string | null;
  partner_id: string | null; service_id: string;
  addons: { name: string; price_pesewas: number }[];
  duration_min: number; guests: number; concurrent: boolean;
  starts_at: string; ends_at: string;
  buffer_before_min: number; buffer_after_min: number;
  location_type: LocationType; city: string; area: string; address: string;
  landmark: string; maps_link: string; hotel_name: string; room_no: string;
  base_pesewas: number; transport_pesewas: number; addons_pesewas: number;
  discount_pesewas: number; tax_pesewas: number; total_pesewas: number;
  status: BookingStatus; payment_status: PaymentStatus;
  consent_confirmed: boolean; notes_internal: string; instructions_client: string;
  source: string; campaign: string; cancel_reason: string | null;
  created_at: string; updated_at: string; archived_at: string | null;
  client_name: string; client_phone: string; client_whatsapp: string;
  client_whatsapp_username: string;
  service_name: string; partner_name: string | null;
  paid_pesewas: number; balance_pesewas: number;
  therapist_names: string[] | null; therapist_ids: string[] | null;
};

export type EnquiryView = {
  id: string; ref: string; client_id: string | null; partner_id: string | null;
  full_name: string; phone_e164: string; whatsapp_e164: string; whatsapp_username: string;
  channel: string; source: string; campaign: string; ad_group: string; keyword: string;
  service_id: string | null; duration_min: number | null; preferred_at: string | null;
  location_type: LocationType; area: string; address: string; landmark: string;
  guests: number; quote_pesewas: number; status: EnquiryStatus;
  owner_id: string | null; follow_up_at: string | null; lost_reason: string | null;
  booking_id: string | null; notes: string;
  created_at: string; archived_at: string | null;
  service_name: string | null; partner_name: string | null;
  owner_name: string | null; booking_ref: string | null;
};

export type Therapist = {
  id: string; user_id: string | null; full_name: string; phone_e164: string;
  gender: "female" | "male"; city: string; base_area: string; active: boolean;
  work_days: number[]; work_start: string; work_end: string;
  max_daily: number; rating: number | null; archived_at: string | null;
};

export type Availability = { available: boolean; reason: string };
