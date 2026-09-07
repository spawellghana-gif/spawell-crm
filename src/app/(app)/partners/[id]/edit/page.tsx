import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { PageHead, ErrorNote } from "@/components/ui";
import { PartnerForm } from "../../partner-form";
import { updatePartner } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditPartnerPage({
  params, searchParams,
}: { params: { id: string }; searchParams: { error?: string } }) {
  await requireRole("owner", "officer");
  const supabase = supabaseServer();
  const { data: partner } = await supabase
    .from("partner").select("*").eq("id", params.id).maybeSingle();
  if (!partner) notFound();

  return (
    <>
      <PageHead
        title={`Edit ${partner.name}`}
        blurb="Changing the commission rate re-values what is owed on every referral, past ones included — the change is written to their timeline so the old rate is not lost."
        actions={<Link className="btn" href={`/partners/${partner.id}`}>Cancel</Link>}
      />
      <ErrorNote message={searchParams.error} />
      <PartnerForm action={updatePartner} partner={partner} submitLabel="Save changes" />
    </>
  );
}
