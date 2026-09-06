import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";
import type { AppRole } from "./types";

export type CurrentUser = {
  id: string;
  email: string | null;
  fullName: string;
  role: AppRole;
  therapistId: string | null;
};

/**
 * The signed-in staff member. Redirects to /login when there is no session.
 *
 * This is for shaping the interface — showing the right nav, hiding the pay
 * column. It is NOT the security boundary: that is Row Level Security in the
 * database, which holds even if this check is bypassed.
 */
export async function requireUser(): Promise<CurrentUser> {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("app_user")
    .select("full_name, role, active")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.active) redirect("/login?error=inactive");

  let therapistId: string | null = null;
  if (profile.role === "therapist") {
    const { data: t } = await supabase
      .from("therapist").select("id").eq("user_id", user.id).maybeSingle();
    therapistId = t?.id ?? null;
  }

  return {
    id: user.id,
    email: user.email ?? null,
    fullName: profile.full_name,
    role: profile.role as AppRole,
    therapistId,
  };
}

export async function requireRole(...roles: AppRole[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/");
  return user;
}

export const isStaff = (r: AppRole) => r === "owner" || r === "officer";
