import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Field } from "@/components/ui";

export const metadata = { title: "Sign in · SpaWell CRM" };

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/");
}

export default function LoginPage({
  searchParams,
}: { searchParams: { error?: string } }) {
  return (
    <main className="login">
      <Card>
        <div style={{ marginBottom: 14 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="mark">SW</span>
            <div>
              <h1 style={{ fontSize: 17 }}>SpaWell CRM</h1>
              <div className="note">SpaWellGhana · Accra</div>
            </div>
          </div>
        </div>

        {searchParams.error && (
          <div className="alert bad" style={{ marginBottom: 12 }}>
            <span aria-hidden="true">⚠</span>
            <span>
              {searchParams.error === "inactive"
                ? "That account is not active. Ask the owner to enable it."
                : searchParams.error}
            </span>
          </div>
        )}

        <form action={signIn} className="stack" style={{ gap: 11 }}>
          <Field label="Email" name="email">
            <input className="inp" id="email" name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Password" name="password">
            <input className="inp" id="password" name="password" type="password" required autoComplete="current-password" />
          </Field>
          <button className="btn pri" type="submit" style={{ justifyContent: "center" }}>
            Sign in
          </button>
        </form>

        <p className="note" style={{ marginTop: 14 }}>
          Accounts are created by the owner in Supabase (Authentication → Users).
          The first account to sign up becomes the owner; everyone after that
          starts as a booking officer.
        </p>
      </Card>
    </main>
  );
}
