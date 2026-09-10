import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const present = (name: string) => Boolean((process.env[name] ?? "").trim());

export async function GET() {
  return NextResponse.json({
    ga4ServiceAccount: present("GA4_SA_CLIENT_EMAIL") && present("GA4_SA_PRIVATE_KEY"),
    adsServiceAccount: present("GOOGLE_ADS_SA_CLIENT_EMAIL") && present("GOOGLE_ADS_SA_PRIVATE_KEY"),
    adsApiOAuth: present("GOOGLE_ADS_DEVELOPER_TOKEN") && present("GOOGLE_ADS_CLIENT_ID") && present("GOOGLE_ADS_CLIENT_SECRET") && present("GOOGLE_ADS_REFRESH_TOKEN"),
    adsDeveloperToken: present("GOOGLE_ADS_DEVELOPER_TOKEN"),
    supabaseServiceRole: present("SUPABASE_SERVICE_ROLE_KEY"),
    cronSecret: present("CRON_SECRET"),
    conversionSyncSecret: present("CONVERSION_SYNC_SECRET"),
    vercelEnv: process.env.VERCEL_ENV ?? "unknown",
  });
}
