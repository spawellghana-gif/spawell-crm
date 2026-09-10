import { getVercelOidcToken } from "@vercel/oidc";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const token = await getVercelOidcToken();
    if (!token) {
      return Response.json({ ok: false, error: "OIDC token unavailable" }, { status: 503 });
    }

    const parts = token.split(".");
    if (parts.length < 2) {
      return Response.json({ ok: false, error: "OIDC token malformed" }, { status: 500 });
    }

    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return Response.json({
      ok: true,
      iss: payload.iss ?? null,
      aud: payload.aud ?? null,
      sub: payload.sub ?? null,
      owner: payload.owner ?? null,
      project: payload.project ?? null,
      environment: payload.environment ?? null,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "OIDC diagnostic failed",
    }, { status: 500 });
  }
}
