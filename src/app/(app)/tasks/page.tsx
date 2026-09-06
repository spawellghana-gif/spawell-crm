import { requireUser, isStaff } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fmtDateTime, titleise } from "@/lib/format";
import { Card, Empty, PageHead, Field, Chip } from "@/components/ui";
import { createTask, toggleTask } from "./actions";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = { urgent: "bad", high: "warn", normal: "", low: "" };

export default async function TasksPage({ searchParams }: { searchParams: { status?: string } }) {
  const user = await requireUser();
  const supabase = supabaseServer();
  const status = searchParams.status ?? "open";

  const [{ data: tasks }, { data: people }] = await Promise.all([
    supabase.from("task").select("*").eq("status", status).order("due_at", { nullsFirst: false }),
    isStaff(user.role)
      ? supabase.from("app_user").select("id, full_name").eq("active", true).order("full_name")
      : Promise.resolve({ data: [{ id: user.id, full_name: user.fullName }] }),
  ]);
  const rows = tasks ?? [];
  const now = new Date().toISOString();

  return (
    <>
      <PageHead
        title="Tasks & follow-ups"
        blurb="Everything that needs a person. You see tasks assigned to you; staff see all of them."
        actions={
          <div className="row">
            <a className={`btn sm ${status === "open" ? "pri" : ""}`} href="/tasks?status=open">Open</a>
            <a className={`btn sm ${status === "done" ? "pri" : ""}`} href="/tasks?status=done">Done</a>
          </div>
        }
      />

      <Card title="New task">
        <form action={createTask} className="stack" style={{ gap: 11 }}>
          <div className="fgrid">
            <Field label="What needs doing" name="title">
              <input className="inp" id="title" name="title" required
                placeholder="Call Selina back about the deep tissue quote" />
            </Field>
            <Field label="Type" name="type">
              <select className="inp" id="type" name="type" defaultValue="follow_up">
                <option value="follow_up">Follow-up</option>
                <option value="payment">Payment follow-up</option>
                <option value="dispatch">Dispatch</option>
                <option value="review">Review request</option>
                <option value="rebooking">Rebooking</option>
                <option value="ops">Ops</option>
              </select>
            </Field>
            <Field label="Priority" name="priority">
              <select className="inp" id="priority" name="priority" defaultValue="normal">
                <option value="urgent">Urgent</option><option value="high">High</option>
                <option value="normal">Normal</option><option value="low">Low</option>
              </select>
            </Field>
            <Field label="Due" name="due_at">
              <input className="inp" id="due_at" name="due_at" type="datetime-local" />
            </Field>
            <Field label="Assignee" name="assignee_id">
              <select className="inp" id="assignee_id" name="assignee_id" defaultValue={user.id}>
                {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
          </div>
          <div><button className="btn pri" type="submit">Add task</button></div>
        </form>
      </Card>

      <div style={{ height: 12 }} />

      <Card pad={false}>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Task</th><th>Type</th><th>Priority</th><th>Due</th><th></th></tr></thead>
            <tbody>
              {rows.map((t) => {
                const overdue = t.status === "open" && t.due_at && t.due_at < now;
                return (
                  <tr key={t.id}>
                    <td><b>{t.title}</b>{t.notes && <div className="note">{t.notes}</div>}</td>
                    <td>{titleise(t.type)}</td>
                    <td><Chip tone={TONE[t.priority]}>{titleise(t.priority)}</Chip></td>
                    <td style={overdue ? { color: "var(--bad)", fontWeight: 600 } : undefined}>
                      {fmtDateTime(t.due_at)}{overdue ? " · overdue" : ""}
                    </td>
                    <td className="r">
                      <form action={toggleTask}>
                        <input type="hidden" name="task_id" value={t.id} />
                        <input type="hidden" name="done" value={t.status === "done" ? "0" : "1"} />
                        <button className="btn sm" type="submit">
                          {t.status === "done" ? "Reopen" : "Complete"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={5}><Empty title="Nothing on the list">Add one above.</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
