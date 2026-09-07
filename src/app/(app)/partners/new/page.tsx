import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { PageHead, ErrorNote } from "@/components/ui";
import { PartnerForm } from "../partner-form";
import { createPartner } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewPartnerPage({
  searchParams,
}: { searchParams: { error?: string } }) {
  await requireRole("owner", "officer");

  return (
    <>
      <PageHead
        title="Add partner"
        blurb="A hotel, corporate client, estate agency or individual who sends you work. Set the commission rate now — the ledger uses it to work out what you owe."
        actions={<Link className="btn" href="/partners">Cancel</Link>}
      />
      <ErrorNote message={searchParams.error} />
      <PartnerForm action={createPartner} submitLabel="Add partner" />
    </>
  );
}
