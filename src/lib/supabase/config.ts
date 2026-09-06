/**
 * Supabase connection details.
 *
 * The URL and the anon key are PUBLIC by design — Supabase ships the anon key
 * to the browser on every request, and Row Level Security, not the key's
 * secrecy, is what protects the data. So a default is safe to commit and lets
 * the app build without env vars configured.
 *
 * Environment variables still win when set, which is how you rotate the key or
 * point a branch at a different project. Set them in Vercel under
 * Settings -> Environment Variables and redeploy.
 *
 * The service_role key is the opposite: it bypasses every policy. It must never
 * appear in this file or any other file the browser can reach.
 */
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://gpuqaukkbxwvtjzrhoro.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwdXFhdWtrYnh3dnRqenJob3JvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MjU2OTcsImV4cCI6MjEwNDIwMTY5N30.hiWL3XGFB_m2moFf9EI5hxDgfdSksbUkBRUUXtI8zWU";
