"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function createTask(formData: FormData) {
  const user = await requireUser();
  const supabase = supabaseServer();
  const title = s(formData, "title");
  if (!title) return;
  await supabase.from("task").insert({
    title,
    type: s(formData, "type") || "follow_up",
    priority: s(formData, "priority") || "normal",
    due_at: s(formData, "due_at") ? new Date(s(formData, "due_at")).toISOString() : null,
    assignee_id: s(formData, "assignee_id") || user.id,
    notes: s(formData, "notes"),
    created_by: user.id,
  });
  revalidatePath("/tasks");
}

export async function toggleTask(formData: FormData) {
  const supabase = supabaseServer();
  const id = s(formData, "task_id");
  const done = s(formData, "done") === "1";
  await supabase.from("task")
    .update({ status: done ? "done" : "open", completed_at: done ? new Date().toISOString() : null })
    .eq("id", id);
  revalidatePath("/tasks");
}
