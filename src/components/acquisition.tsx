import { Card, Chip } from "@/components/ui";
import { ghs, fmtDateTime, titleise } from "@/lib/format";

/**
 * What an ordinary operator needs to know about where a booking came from,
 * and nothing more. Raw click identifiers are deliberately reduced to
 * "Present" — an officer looking at a customer record has no use for a gclid,
 * and putting one on screen invites it into a screenshot.
 */
export function Acquisition({
  source, campaign, keyword, gclid, gbraid, wbraid, landingPage, firstTouchAt, status,
  conversion, showTechnical = false,
}: {
  source?: string;
  campaign?: string;
  keyword?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  landingPage?: string;
  firstTouchAt?: string | null;
  status?: string;
  conversion?: {
    status: string;
    value_pesewas: number;
    dedup_key: string;
    last_attempt_at: string | null;
    skip_reason: string;
    revision: number;
  } | null;
  /** Owner-only: reveals the identifiers themselves. */
  showTechnical?: boolean;
}) {
  const clickId = gclid || gbraid || wbraid || "";
  const isGoogleAds = status === "google_ads";

  const syncLabel: Record<string, { text: string; tone: string }> = {
    synced:  { text: "Synced", tone: "ok" },
    pending: { text: "Pending", tone: "warn" },
    sending: { text: "Sending", tone: "info" },
    failed:  { text: "Failed", tone: "bad" },
    skipped: { text: "Not sent", tone: "" },
    void:    { text: "Cancelled in CRM", tone: "" },
  };

  return (
    <Card title="Acquisition">
      <dl className="meta">
        <dt>Source</dt>
        <dd>
          {isGoogleAds
            ? <Chip tone="ok">Google Ads</Chip>
            : source ? titleise(source.replace(/_/g, " ")) : <span className="note">Not recorded</span>}
        </dd>
        {campaign && (<><dt>Campaign</dt><dd>{campaign}</dd></>)}
        {keyword && (<><dt>Keyword</dt><dd>{keyword}</dd></>)}
        <dt>Ad click</dt>
        <dd>
          {clickId
            ? showTechnical
              ? <span className="mono" style={{ fontSize: 11 }}>{clickId}</span>
              : <Chip tone="ok">Present</Chip>
            : <span className="note">None captured</span>}
        </dd>
        {landingPage && (<><dt>Landing page</dt><dd className="note">{landingPage}</dd></>)}
        <dt>First visit</dt>
        <dd>{firstTouchAt ? fmtDateTime(firstTouchAt) : <span className="note">Unknown</span>}</dd>
      </dl>

      {conversion && (
        <>
          <h4 style={{ marginTop: 16, marginBottom: 6, fontSize: 12.5 }}>Google conversion</h4>
          <dl className="meta">
            <dt>Confirmed booking</dt>
            <dd>{conversion.status === "skipped" ? "Not reported" : "Yes"}</dd>
            <dt>Value</dt>
            <dd className="num">{ghs(conversion.value_pesewas)}</dd>
            <dt>Google sync</dt>
            <dd>
              <Chip tone={syncLabel[conversion.status]?.tone ?? ""}>
                {syncLabel[conversion.status]?.text ?? conversion.status}
              </Chip>
              {conversion.skip_reason && <div className="note">{conversion.skip_reason}</div>}
              {conversion.revision > 1 && (
                <div className="note">Reconfirmed {conversion.revision} times — reported once.</div>
              )}
            </dd>
            {conversion.last_attempt_at && (
              <><dt>Last attempt</dt><dd>{fmtDateTime(conversion.last_attempt_at)}</dd></>
            )}
            {showTechnical && (
              <><dt>Transaction ID</dt><dd className="mono" style={{ fontSize: 11 }}>{conversion.dedup_key}</dd></>
            )}
          </dl>
        </>
      )}

      {!clickId && !conversion && (
        <p className="note" style={{ marginTop: 10 }}>
          No advertising attribution on this record. That is a statement of what
          is known, not a claim that none existed — a customer who messaged
          without carrying a ref is simply unattributable.
        </p>
      )}
    </Card>
  );
}
