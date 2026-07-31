import { all } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { PageHeader } from "@/components/ui/layout-primitives";
import { ReviewQueue } from "./review-queue";
import { requirePageSession } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  await requirePageSession();
  await ensureSeeded();

  const items = all<any>(
    `SELECT ri.*, p.proposalType, p.payload, p.confidence, p.fieldConfidence, p.sourceEmailIds
     FROM ReviewItem ri JOIN AIProposal p ON p.id = ri.proposalId
     WHERE ri.status = 'PENDING'
     ORDER BY ri.createdAt ASC`
  );

  const enriched = items.map((it) => {
    const txn = it.transactionId ? all<any>(`SELECT * FROM TransactionRecord WHERE id = ?`, [it.transactionId])[0] : null;
    const address = it.transactionId
      ? all<any>(
          `SELECT structuredValue FROM ExtractedFact WHERE transactionId = ? AND factType = 'PROPERTY_ADDRESS' AND status = 'CURRENT' LIMIT 1`,
          [it.transactionId]
        )[0]
      : null;
    const sourceEmailIds: string[] = JSON.parse(it.sourceEmailIds);
    const sourceEmails =
      sourceEmailIds.length > 0
        ? all<any>(
            `SELECT * FROM EmailMessage WHERE id IN (${sourceEmailIds.map(() => "?").join(",")}) ORDER BY sentAt ASC`,
            sourceEmailIds
          )
        : [];
    const duplicateCandidates: string[] | null = it.duplicateCandidates ? JSON.parse(it.duplicateCandidates) : null;
    const duplicateTxns = duplicateCandidates
      ? duplicateCandidates.map((dupId) => all<any>(`SELECT * FROM TransactionRecord WHERE id = ?`, [dupId])[0]).filter(Boolean)
      : [];

    return {
      ...it,
      payload: JSON.parse(it.payload),
      fieldConfidence: JSON.parse(it.fieldConfidence),
      transactionStatus: txn?.status ?? null,
      propertyAddress: address ? JSON.parse(address.structuredValue) : "Property pending",
      sourceEmails,
      duplicateTxns,
    };
  });

  return (
    <div className="flex h-[calc(100vh)] flex-col">
      <PageHeader title="Review Queue" subtitle={`${enriched.length} item(s) awaiting approval — nothing here becomes a live record until approved`} />
      <ReviewQueue initialItems={JSON.parse(JSON.stringify(enriched))} />
    </div>
  );
}
